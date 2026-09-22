import React, { useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import AccesoPage from '../pages/AccesoPage';
import BoardPage from '../pages/BoardPage';
import DataDesignPage from '../pages/DataDesignPage';
import Debug from '../pages/Debug';
import GuidePage from '../pages/GuidePage';
import VoiceAssistant from '../pages/VoiceAssistant';
import { usuarioActual, validarSesion, type Usuario } from '../lib/sesion';

/**
 * Guardia de sesion.
 *
 * Ninguna pantalla se monta sin usuario: si se dejara montar el editor y se
 * mostrara el formulario encima, el cliente colaborativo ya habria intentado
 * conectarse sin token y el servidor lo habria rechazado.
 *
 * Al arrancar se valida el token contra el servidor, porque uno vencido
 * guardado en el navegador haria que la aplicacion pareciera abierta y despues
 * fallara en cada peticion. Si el servidor no responde se conserva la sesion:
 * es lo que permite seguir trabajando sin conexion.
 */
const AppRoutes: React.FC = () => {
  const [usuario, setUsuario] = useState<Usuario | null>(usuarioActual);
  const [verificando, setVerificando] = useState(true);

  useEffect(() => {
    let vivo = true;
    void validarSesion().then(async u => {
      if (!vivo) return;
      setUsuario(u);
      
      // Si el usuario ya estaba autenticado y llego por un enlace de invitacion,
      // la aceptamos automaticamente y saltamos a esa pizarra.
      if (u) {
        const params = new URLSearchParams(window.location.search);
        const invitacion = params.get('invitacion');
        if (invitacion) {
          try {
            // Se importa api dinamicamente para no ensuciar las dependencias globales si no hace falta, 
            // o simplemente usamos import arriba. Wait, we need to import `api` from '../lib/apiClient'.
            // I'll add the import above in a separate replacement if needed, but for now I'll just use window.fetch or import api.
            const { api } = await import('../lib/apiClient');
            const res = await api.aceptarInvitacion(invitacion);
            localStorage.setItem('case.boardId', res.boardId);
            window.history.replaceState({}, '', window.location.pathname);
          } catch (err) {
            console.error('Error al aceptar invitacion con sesion activa:', err);
          }
        }
      }
      
      setVerificando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const entrar = useCallback((u: Usuario) => setUsuario(u), []);

  if (verificando && !usuario) {
    return (
      <div className='acceso'>
        <div className='acceso__caja' style={{ textAlign: 'center' }}>
          <span className='spin' /> <span className='muted'>Verificando la sesión...</span>
        </div>
      </div>
    );
  }

  if (!usuario) return <AccesoPage onEntrar={entrar} />;

  return (
    <Routes>
      {/* Escritorio: editor visual completo */}
      <Route path='/' element={<BoardPage />} />
      {/* Fase de diseno de datos: conceptual, mapeo, normalizacion y DDL */}
      <Route path='/datos' element={<DataDesignPage />} />
      {/* Guia de usuario en forma de agente inteligente */}
      <Route path='/guia' element={<GuidePage />} />
      {/* Movil: asistente de voz, sin interfaz grafica */}
      <Route path='/voz' element={<VoiceAssistant />} />
      {/* Diagnostico del backend y de la capa de IA */}
      <Route path='/debug' element={<Debug />} />
    </Routes>
  );
};

export default AppRoutes;
