import { WS_URL } from './env';
import { tokenActual } from './sesion';
import { getIdentity } from './identity';
import { cacheDoc, dequeueOps, enqueueOps, pendingOps, readCachedDoc } from './offlineQueue';
import type {
  CommittedOp,
  ConnectionStatus,
  DiagramDoc,
  Op,
  Participant,
  ServerMessage,
} from './collabTypes';

/**
 * Cliente colaborativo.
 *
 * Como resuelve los problemas propios del trabajo concurrente:
 *  - Escrituras concurrentes: no se envia el documento completo sino operaciones
 *    granulares; el servidor les da un orden total y las reparte.
 *  - Latencia: la operacion se aplica de inmediato en local (optimista) y se
 *    confirma despues.
 *  - Desconexion: cada operacion se persiste en IndexedDB antes de enviarse y se
 *    reenvia al reconectar. El servidor la descarta si ya la tenia.
 *  - Divergencia: si el servidor rechaza una operacion, se pide el documento completo.
 *  - Conciencia de grupo: presencia con nombre, color y que clase esta tocando cada uno.
 */

export interface CollabHandlers {
  onSnapshot: (doc: DiagramDoc, seq: number) => void;
  onRemoteOps: (ops: CommittedOp[]) => void;
  onPresence: (participants: Participant[]) => void;
  onStatus: (status: ConnectionStatus, pending: number, motivo?: string | null) => void;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const HEARTBEAT_MS = 25000;

export class CollabClient {
  private socket: WebSocket | null = null;
  private diagramId: string | null = null;
  private handlers: CollabHandlers | null = null;
  private seq = 0;
  private attempt = 0;
  private status: ConnectionStatus = 'offline';
  /** Por que el servidor rechazo la union, si la rechazo. */
  private motivo: string | null = null;
  /** Con un rechazo no se reintenta: reintentar no arregla una sesion vencida. */
  private rechazado = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;

  readonly identity = getIdentity();

  async connect(diagramId: string, handlers: CollabHandlers): Promise<void> {
    this.disconnect();
    this.diagramId = diagramId;
    this.handlers = handlers;
    this.closedByUs = false;
    this.attempt = 0;
    // Un intento nuevo (recarga, o volver a entrar tras un rechazo) arranca sin
    // el rechazo anterior: si la sesion se renovo, hay que volver a probar.
    this.rechazado = false;
    this.motivo = null;

    // Antes de tocar la red: mostramos lo que haya en cache, para que la app
    // sea usable de inmediato y tambien sin servidor.
    const cached = await readCachedDoc(diagramId);
    if (cached) {
      this.seq = cached.seq;
      handlers.onSnapshot(cached.doc, cached.seq);
    }

    this.open();
    window.addEventListener('online', this.handleBrowserOnline);
    window.addEventListener('offline', this.handleBrowserOffline);
  }

  disconnect(): void {
    this.closedByUs = true;
    window.removeEventListener('online', this.handleBrowserOnline);
    window.removeEventListener('offline', this.handleBrowserOffline);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = null;
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.diagramId = null;
    this.handlers = null;
  }

  /**
   * Envia operaciones. Se persisten primero, asi que si no hay red quedan en cola
   * y la interfaz sigue respondiendo con el cambio ya aplicado en local.
   */
  async send(ops: Op[]): Promise<void> {
    if (!this.diagramId || ops.length === 0) return;
    await enqueueOps(this.diagramId, ops);
    await this.reportStatus();

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'ops', ops }));
    }
  }

  /** Construye una operacion con la identidad de este participante. */
  buildOp(kind: Op['kind'], payload: Record<string, unknown>, opId: string): Op {
    return {
      opId,
      kind,
      clientId: this.identity.clientId,
      actorName: this.identity.name,
      localTs: Date.now(),
      payload,
    };
  }

  /** Avisa que clase esta seleccionando, para el bloqueo suave entre participantes. */
  announceSelection(selection: string | null): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'selection', selection }));
    }
  }

  requestResync(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'resync' }));
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  // ---------------- interno ----------------

  private handleBrowserOnline = () => {
    // El navegador recupero la red: no esperamos el backoff completo.
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.attempt = 0;

    // Perder la red no siempre cierra el socket (el navegador puede dejarlo abierto
    // y encolar los envios). En ese caso `open()` no hace nada, asi que hay que
    // restaurar el estado y reenviar la cola a mano, o la interfaz se queda
    // mostrando "sin conexion" para siempre.
    if (this.socket?.readyState === WebSocket.OPEN) {
      void this.setStatus('online');
      void this.flushQueue();
      // Pedimos lo que nos perdimos mientras no habia red.
      this.requestResync();
      return;
    }
    this.open();
  };

  private handleBrowserOffline = () => {
    void this.setStatus('offline');
  };

  private open(): void {
    if (!this.diagramId || this.closedByUs) return;
    if (this.rechazado) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    void this.setStatus('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(WS_URL);
    } catch (err) {
      console.warn('[collab] no se pudo abrir el WebSocket', err);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      socket.send(
        JSON.stringify({
          type: 'join',
          diagramId: this.diagramId,
          clientId: this.identity.clientId,
          name: this.identity.name,
          color: this.identity.color,
          lastSeq: this.seq,
          // La identidad real la resuelve el servidor a partir del token; el
          // nombre y el color de arriba son solo la preferencia visual.
          token: tokenActual() ?? undefined,
        })
      );
      void this.setStatus('online');
      void this.flushQueue();

      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_MS);
    };

    socket.onmessage = event => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    socket.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.socket = null;
      if (!this.closedByUs) {
        void this.setStatus('offline');
        this.scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // onclose se encarga de la reconexion; aqui solo evitamos el error no manejado.
    };
  }

  private handleMessage(msg: ServerMessage): void {
    const handlers = this.handlers;
    const diagramId = this.diagramId;
    if (!handlers || !diagramId) return;

    switch (msg.type) {
      case 'snapshot':
        this.seq = msg.seq;
        handlers.onSnapshot(msg.doc, msg.seq);
        void cacheDoc(diagramId, msg.doc, msg.seq);
        // Lo pendiente se vuelve a enviar sobre el documento recien recibido.
        void this.flushQueue();
        break;

      case 'ops':
        if (msg.ops.length === 0) return;
        this.seq = Math.max(this.seq, msg.ops[msg.ops.length - 1].seq);
        handlers.onRemoteOps(msg.ops);
        break;

      case 'ack':
        if (msg.seq > this.seq) this.seq = msg.seq;
        void dequeueOps([...msg.accepted, ...msg.rejected]).then(() => this.reportStatus());
        if (msg.rejected.length > 0) {
          // Nuestro estado optimista ya no coincide con el del servidor
          // (por ejemplo editamos algo que otra persona borro): recargamos.
          console.warn(`[collab] ${msg.rejected.length} operacion(es) rechazada(s); resincronizando`);
          this.requestResync();
        }
        break;

      case 'presence':
        handlers.onPresence(msg.participants);
        break;

      case 'error': {
        console.error('[collab] error del servidor:', msg.message);
        // Un rechazo de union no se arregla reintentando: la sesion vencio, o
        // esta pizarra no es suya. Se corta el bucle y se dice el motivo, que
        // antes quedaba solo en la consola mientras la barra decia "Sin
        // conexion" para siempre.
        if (/sesion|acceso|solo lectura/i.test(msg.message)) {
          this.motivo = msg.message;
          this.rechazado = true;
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          void this.setStatus('rechazado');
        }
        break;
      }

      case 'pong':
        break;
    }
  }

  private async flushQueue(): Promise<void> {
    if (!this.diagramId || this.socket?.readyState !== WebSocket.OPEN) return;
    const ops = await pendingOps(this.diagramId);
    if (ops.length === 0) return;
    console.log(`[collab] reenviando ${ops.length} operacion(es) de la cola offline`);
    this.socket.send(JSON.stringify({ type: 'ops', ops }));
  }

  private scheduleReconnect(): void {
    if (this.closedByUs || this.rechazado) return;
    this.attempt += 1;
    // Backoff exponencial con tope, para no golpear el servidor cuando esta caido.
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.attempt - 1), RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private async setStatus(status: ConnectionStatus): Promise<void> {
    this.status = status;
    await this.reportStatus();
  }

  private async reportStatus(): Promise<void> {
    if (!this.handlers || !this.diagramId) return;
    const ops = await pendingOps(this.diagramId);
    this.handlers.onStatus(this.status, ops.length, this.motivo);
  }

  /** Guarda el documento actual en cache, para tenerlo disponible sin red. */
  cacheCurrent(doc: DiagramDoc): void {
    if (this.diagramId) void cacheDoc(this.diagramId, doc, this.seq);
  }
}

export const collabClient = new CollabClient();
