import type { DiagramDoc, Op } from './collabTypes';

/**
 * Cola de operaciones pendientes y cache del documento, en IndexedDB.
 *
 * Es lo que permite trabajar con la red caida: cada operacion que el usuario hace
 * se persiste antes de intentar enviarla, asi sobrevive a un corte, a cerrar la
 * pestana o a recargar. Al reconectar se reenvia toda la cola; el servidor descarta
 * duplicados por `opId`, asi que reenviar de mas es inofensivo.
 */

const DB_NAME = 'case-offline';
const DB_VERSION = 1;
const OPS_STORE = 'pendingOps';
const DOC_STORE = 'docs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OPS_STORE)) {
        const store = db.createObjectStore(OPS_STORE, { keyPath: 'opId' });
        store.createIndex('byDiagram', 'diagramId');
      }
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        db.createObjectStore(DOC_STORE, { keyPath: 'diagramId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

interface StoredOp extends Op {
  diagramId: string;
  queuedAt: number;
}

/** Guarda una operacion como pendiente. Se llama ANTES de intentar enviarla. */
export async function enqueueOps(diagramId: string, ops: Op[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(OPS_STORE, 'readwrite');
      const store = transaction.objectStore(OPS_STORE);
      for (const op of ops) {
        const stored: StoredOp = { ...op, diagramId, queuedAt: Date.now() };
        store.put(stored);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.warn('[offline] no se pudo encolar; la op se envia solo en linea', err);
  }
}

/** Marca operaciones como confirmadas por el servidor: salen de la cola. */
export async function dequeueOps(opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(OPS_STORE, 'readwrite');
      const store = transaction.objectStore(OPS_STORE);
      for (const id of opIds) store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (err) {
    console.warn('[offline] no se pudo limpiar la cola', err);
  }
}

/** Operaciones pendientes del diagrama, en el orden en que las hizo el usuario. */
export async function pendingOps(diagramId: string): Promise<Op[]> {
  try {
    const all = await tx<StoredOp[]>(OPS_STORE, 'readonly', s => s.getAll() as IDBRequest<StoredOp[]>);
    return all
      .filter(o => o.diagramId === diagramId)
      .sort((a, b) => a.queuedAt - b.queuedAt)
      // Quitamos los campos que son solo de la cola local; el servidor recibe la op pura.
      .map(stored => {
        const op: Op = {
          opId: stored.opId,
          kind: stored.kind,
          clientId: stored.clientId,
          actorName: stored.actorName,
          localTs: stored.localTs,
          payload: stored.payload,
        };
        return op;
      });
  } catch (err) {
    console.warn('[offline] no se pudo leer la cola', err);
    return [];
  }
}

export async function pendingCount(diagramId: string): Promise<number> {
  return (await pendingOps(diagramId)).length;
}

/** Cache del documento: permite abrir la app y seguir trabajando sin servidor. */
export async function cacheDoc(diagramId: string, doc: DiagramDoc, seq: number): Promise<void> {
  try {
    await tx(DOC_STORE, 'readwrite', s => s.put({ diagramId, doc, seq, savedAt: Date.now() }));
  } catch (err) {
    console.warn('[offline] no se pudo cachear el documento', err);
  }
}

export async function readCachedDoc(
  diagramId: string
): Promise<{ doc: DiagramDoc; seq: number } | null> {
  try {
    const row = await tx<{ doc: DiagramDoc; seq: number } | undefined>(DOC_STORE, 'readonly', s =>
      s.get(diagramId)
    );
    return row ? { doc: row.doc, seq: row.seq } : null;
  } catch {
    return null;
  }
}
