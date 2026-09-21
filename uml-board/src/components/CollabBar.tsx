import React, { useState } from 'react';
import { getIdentity, setIdentityName } from '../lib/identity';
import { cerrarSesion, usuarioActual } from '../lib/sesion';
import { useClassStore } from '../store/classStore';
import { Menu, MenuDivider, MenuItem, MenuLabel } from './Menu';

/**
 * Indicadores de la sesión colaborativa: conexión, cola de cambios pendientes y
 * participantes. Vive aparte de la barra para que Toolbar se ocupe solo de las
 * acciones, y porque es el bloque que hay que mostrar al demostrar el trabajo
 * colaborativo.
 */

const ESTADOS = {
  online: { clase: 'chip chip--ok', texto: 'En línea' },
  connecting: { clase: 'chip chip--warn', texto: 'Conectando' },
  offline: { clase: 'chip chip--danger', texto: 'Sin conexión' },
} as const;

const CollabBar: React.FC = () => {
  const connection = useClassStore(s => s.connection);
  const pendingOps = useClassStore(s => s.pendingOps);
  const participants = useClassStore(s => s.participants);
  const conflictos = useClassStore(s => s.conflictos);
  const descartarConflicto = useClassStore(s => s.descartarConflicto);

  const [identity, setIdentity] = useState(getIdentity);
  const usuario = usuarioActual();
  const [editando, setEditando] = useState(false);

  const estado = ESTADOS[connection];

  return (
    <>
      <span className={estado.clase} title='Conexión con el servidor colaborativo'>
        <span className='chip__dot' />
        {estado.texto}
      </span>

      {pendingOps > 0 && (
        <span
          className='chip chip--warn'
          title='Cambios guardados en este dispositivo, pendientes de enviar al servidor'
        >
          {pendingOps} en cola
        </span>
      )}

      {/* Aviso de edicion simultanea. El orden total ya evito que el documento
          se corrompa; esto cubre la parte que faltaba, que es que la persona
          sepa que le pisaron el cambio en vez de ver desaparecer su texto. */}
      {conflictos.map(c => (
        <button
          key={c.id}
          className='chip chip--warn'
          title='Hacé clic para descartar el aviso'
          onClick={() => descartarConflicto(c.id)}
        >
          {c.autor} cambió {c.campo} en {c.clase}
        </button>
      ))}

      <Menu
        label={participants.length > 1 ? `${participants.length} en línea` : 'Solo yo'}
        icon='◉'
        align='right'
        title='Participantes en esta pizarra'
        minWidth={250}
      >
        {() => (
          <>
            <MenuLabel>En esta pizarra</MenuLabel>
            {participants.length === 0 && (
              <MenuItem icon='·' disabled>
                Nadie más conectado
              </MenuItem>
            )}
            {participants.map(p => (
              <div className='menu__item' key={p.clientId} style={{ cursor: 'default' }}>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    background: p.color,
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'grid',
                    placeItems: 'center',
                    flex: 'none',
                  }}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </span>
                <span style={{ flex: 1 }}>{p.name}</span>
                {/* El enunciado pide que la sesion tenga un anfitrion; el
                    servidor lo calcula por antiguedad y lo traspasa solo. */}
                {p.esAnfitrion && <span className='menu__hint'>anfitrión</span>}
                {p.rol === 'lector' && <span className='menu__hint'>solo lectura</span>}
                {p.clientId === identity.clientId && <span className='menu__hint'>yo</span>}
                {p.selection && p.clientId !== identity.clientId && (
                  <span className='menu__hint'>editando</span>
                )}
              </div>
            ))}

            <MenuDivider />
            {usuario ? (
              <>
                <MenuLabel>Mi cuenta</MenuLabel>
                <div style={{ padding: '2px 10px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{usuario.nombre}</div>
                  <div className='muted small'>{usuario.correo}</div>
                </div>
                {/* Con sesion iniciada el nombre visible sale de la cuenta: si
                    se pudiera cambiar aca, dos personas podrian mostrarse con
                    el mismo nombre en la pizarra. */}
                <MenuItem
                  icon='⎋'
                  onClick={() => {
                    cerrarSesion();
                    window.location.reload();
                  }}
                >
                  Cerrar sesión
                </MenuItem>
              </>
            ) : (
              <>
                <MenuLabel>Mi nombre visible</MenuLabel>
                <div style={{ padding: '2px 6px 6px' }}>
                  {editando ? (
                    <input
                      className='input'
                      style={{ width: '100%' }}
                      autoFocus
                      defaultValue={identity.name}
                      onBlur={e => {
                        setIdentity(setIdentityName(e.target.value.trim() || identity.name));
                        setEditando(false);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  ) : (
                    <button
                      className='btn btn--sm'
                      style={{ width: '100%' }}
                      onClick={() => setEditando(true)}
                    >
                      {identity.name}, cambiar
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </Menu>
    </>
  );
};

export default CollabBar;
