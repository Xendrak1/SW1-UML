import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { commitOps, getOpsSince, getSnapshot, knownOpIds } from './rooms.js';
import { config } from './config.js';
import { verificarToken } from './auth/tokens.js';
import { accesoADiagrama } from './auth/acceso.js';
import type { ClientMessage, Participant, ServerMessage } from './types.js';

interface Session {
  socket: WebSocket;
  diagramId: string;
  clientId: string;
  name: string;
  color: string;
  selection: string | null;
  alive: boolean;
  /** Momento en que se conecto: desempata el anfitrion entre propietarios. */
  desde: number;
  /** Usuario autenticado, si lo hay. */
  usuarioId: string | null;
  rol: string;
}

const sessions = new Set<Session>();

const send = (socket: WebSocket, msg: ServerMessage) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
};

const broadcast = (diagramId: string, msg: ServerMessage, exclude?: Session) => {
  for (const s of sessions) {
    if (s.diagramId === diagramId && s !== exclude) send(s.socket, msg);
  }
};

function participantsOf(diagramId: string): Participant[] {
  const seen = new Map<string, Participant>();
  for (const s of sessions) {
    if (s.diagramId !== diagramId) continue;
    // Una misma persona puede tener dos pestanas: se muestra una sola vez, con
    // la mas antigua de las dos, que es la que define su antiguedad.
    const previo = seen.get(s.clientId);
    if (previo && (previo.desde ?? 0) <= s.desde) continue;
    seen.set(s.clientId, {
      clientId: s.clientId,
      name: s.name,
      color: s.color,
      selection: s.selection,
      desde: s.desde,
      rol: s.rol,
      esAnfitrion: false,
      usuarioId: s.usuarioId ?? undefined,
    });
  }

  const lista = [...seen.values()].sort((a, b) => (a.desde ?? 0) - (b.desde ?? 0));
  // El anfitrion es el propietario de la pizarra, que es un dato guardado y no
  // depende de quien se conecto primero. Si el propietario no esta conectado,
  // el rol lo ejerce el participante mas antiguo, para que la sesion no quede
  // sin anfitrion mientras el dueno no esta.
  const propietario = lista.find(p => p.rol === 'propietario');
  if (propietario) propietario.esAnfitrion = true;
  else if (lista.length > 0) lista[0].esAnfitrion = true;
  return lista;
}

const announcePresence = (diagramId: string) =>
  broadcast(diagramId, { type: 'presence', participants: participantsOf(diagramId) });

export function kickParticipant(diagramId: string, usuarioId: string): void {
  for (const s of [...sessions]) {
    if (s.diagramId === diagramId && s.usuarioId === usuarioId) {
      send(s.socket, {
        type: 'error',
        message: 'Has sido expulsado de la pizarra',
      });
      s.socket.close();
      sessions.delete(s);
    }
  }
  announcePresence(diagramId);
}

/** Si el cliente esta demasiado atras, sale mas barato mandarle el documento completo. */
const CATCHUP_LIMIT = 500;

export function attachWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    let session: Session | null = null;

    socket.on('message', async raw => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(socket, { type: 'error', message: 'JSON invalido' });
        return;
      }

      try {
        switch (msg.type) {
          case 'join': {
            // La identidad sale del token, no de lo que diga el cliente: el
            // nombre y el color que llegan en el mensaje son una preferencia
            // visual, y cualquiera podria mandar el nombre de otro.
            const sesionToken = msg.token ? verificarToken(msg.token) : null;

            if (!sesionToken && config.auth.requerida) {
              send(socket, { type: 'error', message: 'Necesitas iniciar sesion para entrar a la pizarra' });
              socket.close();
              return;
            }

            const acceso = await accesoADiagrama(msg.diagramId, sesionToken?.sub ?? null);
            if (!acceso) {
              send(socket, { type: 'error', message: 'No tenes acceso a esta pizarra' });
              socket.close();
              return;
            }
            // El invitado en espera no entra a la sala hasta que el anfitrion lo
            // apruebe: su pantalla de acceso ya le esta mostrando el estado.
            if (acceso.rol === 'pendiente') {
              send(socket, {
                type: 'error',
                message: 'Tu acceso a esta pizarra esta pendiente de aprobacion del anfitrion',
              });
              socket.close();
              return;
            }

            session = {
              socket,
              diagramId: msg.diagramId,
              clientId: sesionToken?.sub ?? msg.clientId,
              name: sesionToken?.nombre || msg.name || 'Invitado',
              color: msg.color || '#667eea',
              selection: null,
              alive: true,
              desde: Date.now(),
              usuarioId: sesionToken?.sub ?? null,
              rol: acceso.rol,
            };
            sessions.add(session);

            const { doc, seq } = await getSnapshot(msg.diagramId);
            const behind = seq - (msg.lastSeq ?? 0);

            if (msg.lastSeq > 0 && behind > 0 && behind <= CATCHUP_LIMIT) {
              // Reconexion corta: solo lo que se perdio. El cliente conserva su estado local.
              const missed = await getOpsSince(msg.diagramId, msg.lastSeq);
              send(socket, { type: 'ops', ops: missed });
            } else if (msg.lastSeq !== seq) {
              // Primera conexion, o desconexion larga: documento completo.
              send(socket, { type: 'snapshot', diagramId: msg.diagramId, doc, seq });
            }

            announcePresence(msg.diagramId);
            break;
          }

          case 'ops': {
            if (!session) {
              send(socket, { type: 'error', message: 'Debe enviar "join" antes de "ops"' });
              return;
            }
            if (session.rol === 'lector') {
              // Se rechazan todas: el cliente las revierte con el ack, igual que
              // hace con una op descartada por el estado del documento.
              send(socket, {
                type: 'ack',
                accepted: [],
                rejected: msg.ops.map(o => o.opId),
                seq: 0,
              });
              send(socket, { type: 'error', message: 'Tenes acceso de solo lectura a esta pizarra' });
              return;
            }
            const committed = await commitOps(session.diagramId, msg.ops);
            const acceptedIds = new Set(committed.map(o => o.opId));

            // Una op puede no entrar al documento por dos razones distintas:
            //  - ya estaba aplicada (reenvio tras reconectar): no es un problema
            //  - fue descartada por el estado actual (edito algo que otro borro): el
            //    emisor quedo divergente y debe resincronizar
            const notApplied = msg.ops.filter(o => !acceptedIds.has(o.opId));
            const duplicated = await knownOpIds(
              session.diagramId,
              notApplied.map(o => o.opId)
            );
            const rejected = notApplied.filter(o => !duplicated.has(o.opId)).map(o => o.opId);

            send(socket, {
              type: 'ack',
              accepted: [...acceptedIds],
              rejected,
              seq: committed.at(-1)?.seq ?? 0,
            });
            if (committed.length > 0) {
              broadcast(session.diagramId, { type: 'ops', ops: committed }, session);
            }
            break;
          }

          case 'resync': {
            if (!session) return;
            const { doc, seq } = await getSnapshot(session.diagramId);
            send(socket, { type: 'snapshot', diagramId: session.diagramId, doc, seq });
            break;
          }

          case 'selection': {
            if (!session) return;
            session.selection = msg.selection;
            announcePresence(session.diagramId);
            break;
          }

          case 'ping': {
            if (session) session.alive = true;
            send(socket, { type: 'pong' });
            break;
          }
        }
      } catch (err) {
        console.error('[ws] error procesando mensaje', err);
        send(socket, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Error interno',
        });
      }
    });

    socket.on('pong', () => {
      if (session) session.alive = true;
    });

    socket.on('close', () => {
      if (!session) return;
      const { diagramId } = session;
      sessions.delete(session);
      session = null;
      announcePresence(diagramId);
    });

    socket.on('error', err => console.error('[ws] socket error', err));
  });

  // Barrido de conexiones muertas: sin esto la lista de participantes se llena de fantasmas
  // cuando alguien cierra la laptop en vez de cerrar la pestana.
  setInterval(() => {
    for (const s of [...sessions]) {
      if (!s.alive) {
        s.socket.terminate();
        sessions.delete(s);
        announcePresence(s.diagramId);
        continue;
      }
      s.alive = false;
      try {
        s.socket.ping();
      } catch {
        /* se limpia en el proximo barrido */
      }
    }
  }, 30_000).unref();

  console.log('[ws] servidor colaborativo escuchando en /ws');
}
