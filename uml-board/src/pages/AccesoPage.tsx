import React, { useEffect, useState } from 'react';
import { ThemeToggle } from '../lib/theme';
import { iniciarSesion, modoDeAcceso, registrarse, type Usuario } from '../lib/sesion';

/**
 * Pantalla de acceso.
 *
 * Es la puerta de entrada al sistema: sin sesion no se abre ninguna pizarra, ni
 * desde el escritorio ni desde el telefono. El mismo formulario sirve para
 * entrar y para crear la cuenta, porque son dos campos de diferencia y un
 * formulario aparte solo agregaria una pantalla mas.
 */

interface Props {
  onEntrar: (u: Usuario) => void;
}

const AccesoPage: React.FC<Props> = ({ onEntrar }) => {
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [codigo, setCodigo] = useState('');
  const [requiereCodigo, setRequiereCodigo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // En un despliegue publico el registro puede estar protegido con un codigo.
  useEffect(() => {
    let vivo = true;
    void modoDeAcceso().then(m => {
      if (vivo) setRequiereCodigo(m.requiereCodigo);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const usuario =
        modo === 'login'
          ? await iniciarSesion(correo, password)
          : await registrarse(nombre, correo, password, codigo);
      onEntrar(usuario);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la operación');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className='acceso'>
      <div className='acceso__caja'>
        <div className='acceso__cabecera'>
          <div>
            <h1 className='acceso__titulo'>Herramienta CASE</h1>
            <p className='muted small' style={{ margin: '4px 0 0' }}>
              Modelado UML colaborativo
            </p>
          </div>
          <ThemeToggle />
        </div>

        <form onSubmit={enviar}>
          {modo === 'registro' && (
            <label className='acceso__campo'>
              <span className='muted small'>Nombre y apellido</span>
              <input
                className='input'
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                autoComplete='name'
                required
                minLength={2}
              />
            </label>
          )}

          <label className='acceso__campo'>
            <span className='muted small'>Correo</span>
            <input
              className='input'
              type='email'
              value={correo}
              onChange={e => setCorreo(e.target.value)}
              autoComplete='email'
              required
            />
          </label>

          <label className='acceso__campo'>
            <span className='muted small'>Contraseña</span>
            <input
              className='input'
              type='password'
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
            />
            {modo === 'registro' && (
              <span className='muted small'>Al menos 8 caracteres.</span>
            )}
          </label>

          {modo === 'registro' && requiereCodigo && (
            <label className='acceso__campo'>
              <span className='muted small'>Código de registro</span>
              <input
                className='input'
                value={codigo}
                onChange={e => setCodigo(e.target.value)}
                required
              />
              <span className='muted small'>Te lo comparte quien administra el sistema.</span>
            </label>
          )}

          {error && (
            <div className='notice notice--warn' style={{ marginTop: 12 }} role='alert'>
              {error}
            </div>
          )}

          <button
            className='btn btn--primary'
            type='submit'
            disabled={enviando}
            style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}
          >
            {enviando
              ? 'Un momento...'
              : modo === 'login'
                ? 'Entrar'
                : 'Crear la cuenta'}
          </button>
        </form>

        <button
          className='btn btn--ghost'
          style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}
          onClick={() => {
            setModo(m => (m === 'login' ? 'registro' : 'login'));
            setError(null);
          }}
        >
          {modo === 'login' ? 'No tengo cuenta, quiero crear una' : 'Ya tengo cuenta'}
        </button>
      </div>
    </div>
  );
};

export default AccesoPage;
