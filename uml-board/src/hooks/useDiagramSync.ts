import { useCallback, useEffect, useState } from 'react';
import { api, type BoardRow } from '../lib/apiClient';

/** Compatibilidad con el codigo que esperaba el tipo de Supabase. */
export type Board = BoardRow;

interface UseBoardsReturn {
  boards: Board[];
  isLoading: boolean;
  error: string | null;
  createBoard: (name: string) => Promise<string>;
  deleteBoard: (boardId: string) => Promise<void>;
  renameBoard: (boardId: string, newName: string) => Promise<void>;
  refreshBoards: () => Promise<void>;
}

const BOARDS_CACHE_KEY = 'case.boards.cache';

/**
 * Pizarras del backend propio.
 * La lista se cachea en localStorage para que la app abra tambien sin servidor:
 * con la lista en mano, el documento sale de IndexedDB y se puede seguir trabajando.
 */
export function useBoards(): UseBoardsReturn {
  const [boards, setBoards] = useState<Board[]>(() => {
    try {
      const raw = localStorage.getItem(BOARDS_CACHE_KEY);
      return raw ? (JSON.parse(raw) as Board[]) : [];
    } catch {
      return [];
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cache = (rows: Board[]) => {
    try {
      localStorage.setItem(BOARDS_CACHE_KEY, JSON.stringify(rows));
    } catch {
      /* sin cache: solo se pierde el modo offline en la primera carga */
    }
  };

  const loadBoards = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const rows = await api.listBoards();
      setBoards(rows);
      cache(rows);
    } catch (err) {
      console.warn('[boards] no se pudo consultar el servidor, se usa la cache local', err);
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createBoard = useCallback(async (name: string) => {
    const board = await api.createBoard(name);
    setBoards(prev => {
      const next = [...prev, board];
      cache(next);
      return next;
    });
    return board.id;
  }, []);

  const deleteBoard = useCallback(async (boardId: string) => {
    await api.deleteBoard(boardId);
    setBoards(prev => {
      const next = prev.filter(b => b.id !== boardId);
      cache(next);
      return next;
    });
  }, []);

  const renameBoard = useCallback(async (boardId: string, newName: string) => {
    await api.renameBoard(boardId, newName);
    setBoards(prev => {
      const next = prev.map(b => (b.id === boardId ? { ...b, name: newName } : b));
      cache(next);
      return next;
    });
  }, []);

  useEffect(() => {
    void loadBoards();
    // Al recuperar la red, refrescamos la lista de pizarras.
    const onOnline = () => void loadBoards();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [loadBoards]);

  return { boards, isLoading, error, createBoard, deleteBoard, renameBoard, refreshBoards: loadBoards };
}

/** Estado de la IA (local vs nube), para mostrarlo en la interfaz. */
export function useAiStatus() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.aiStatus>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .aiStatus()
        .then(s => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          if (!cancelled) setStatus(null);
        });
    void check();
    const timer = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return status;
}
