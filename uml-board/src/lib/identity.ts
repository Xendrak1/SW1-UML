import { v4 as uuidv4 } from 'uuid';
import { usuarioActual } from './sesion';

/**
 * Identidad del participante, estable entre recargas y reconexiones.
 * El `clientId` es lo que hace que la cola offline sea idempotente: si la persona
 * recarga la pagina, sus operaciones pendientes siguen siendo suyas.
 */
export interface Identity {
  clientId: string;
  name: string;
  color: string;
}

const KEY = 'case.identity';

const COLORS = [
  '#e74c3c',
  '#27ae60',
  '#2980b9',
  '#8e44ad',
  '#d35400',
  '#16a085',
  '#c0392b',
  '#2c3e50',
];

const NAMES = ['Analista', 'Disenador', 'Arquitecto', 'Modelador', 'Revisor'];

function create(): Identity {
  return {
    clientId: uuidv4(),
    name: `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${Math.floor(Math.random() * 90) + 10}`,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

export function getIdentity(): Identity {
  // Con sesion iniciada la identidad es la del usuario, y el clientId es su id:
  // asi el "yo" de la lista de participantes coincide con lo que informa el
  // servidor, que tambien usa el id del usuario.
  const usuario = usuarioActual();
  if (usuario) {
    return { clientId: usuario.id, name: usuario.nombre, color: usuario.color };
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      if (parsed.clientId && parsed.name && parsed.color) return parsed as Identity;
    }
  } catch {
    /* localStorage bloqueado: seguimos con una identidad efimera */
  }
  const identity = create();
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* sin persistencia, pero la sesion funciona */
  }
  return identity;
}

export function setIdentityName(name: string): Identity {
  const identity = { ...getIdentity(), name };
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* ignorado */
  }
  return identity;
}
