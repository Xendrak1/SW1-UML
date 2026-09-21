import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAiStatus } from '../hooks/useDiagramSync';
import { api } from '../lib/apiClient';
import { API_URL, WS_URL } from '../lib/env';
import { getIdentity } from '../lib/identity';
import { ThemeToggle } from '../lib/theme';

/**
 * Panel de diagnóstico: estado del backend propio, de la IA local y en la nube, y
 * de las imágenes archivadas. Es la primera pantalla a mirar cuando algo no anda.
 */

interface UploadRow {
  filename: string;
  mime_type: string;
  size_bytes: string;
  url: string;
}

const Pill: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <span className={ok ? 'chip chip--ok' : 'chip chip--danger'}>
    <span className='chip__dot' />
    {children}
  </span>
);

const Debug: React.FC = () => {
  const [health, setHealth] = useState<'up' | 'down' | 'checking'>('checking');
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [message, setMessage] = useState<string>('');
  const aiStatus = useAiStatus();
  const identity = getIdentity();

  const refresh = useCallback(async () => {
    try {
      await api.health();
      setHealth('up');
      setUploads(await api.listUploads());
    } catch {
      setHealth('down');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setMessage('Subiendo...');
      const res = await api.uploadFile(file);
      setMessage(`Subido: ${res.filename}`);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Error subiendo el archivo');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className='page'>
      <div className='page__head'>
        <h1 className='page__title'>Diagnóstico</h1>
        <Link to='/' className='btn'>
          ← Volver a la pizarra
        </Link>
        <button className='btn' onClick={() => void refresh()}>
          Volver a verificar
        </button>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
      </div>
      <p className='page__sub'>Estado de los servicios de los que depende la aplicación.</p>

      <div className='card'>
        <h3 className='card__title'>Backend</h3>
        <div className='row' style={{ marginBottom: 10 }}>
          <Pill ok={health === 'up'}>
            {health === 'up' ? 'conectado' : health === 'down' ? 'sin conexión' : 'verificando'}
          </Pill>
          <code>{API_URL}</code>
        </div>
        <div className='muted small'>
          WebSocket colaborativo: <code>{WS_URL}</code>
        </div>
        {health === 'down' && (
          <div className='notice notice--danger' style={{ marginTop: 14 }}>
            El servidor no responde. Levantá la base con <code>docker compose up -d</code> y el
            servidor con <code>npm run dev</code> dentro de <code>server/</code>.
          </div>
        )}
      </div>

      <div className='card'>
        <h3 className='card__title'>Capa de IA</h3>
        {aiStatus ? (
          <>
            <p className='muted small' style={{ marginTop: 0 }}>
              Estrategia configurada: <strong style={{ color: 'var(--text)' }}>{aiStatus.strategy}</strong>
            </p>
            <table className='table'>
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Estado</th>
                  <th>Modelo de texto</th>
                  <th>Modelo de visión</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Local</strong> (Ollama)
                    <div className='muted small'>{aiStatus.local.baseUrl}</div>
                  </td>
                  <td>
                    <Pill ok={aiStatus.local.available}>
                      {aiStatus.local.available ? 'disponible' : 'no disponible'}
                    </Pill>
                  </td>
                  <td>
                    <code>{aiStatus.local.model}</code>{' '}
                    {aiStatus.local.modelInstalado === false && (
                      <Pill ok={false}>sin descargar</Pill>
                    )}
                  </td>
                  <td>
                    <code>{aiStatus.local.visionModel}</code>{' '}
                    {aiStatus.local.visionModelInstalado === false && (
                      <Pill ok={false}>sin descargar</Pill>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Nube</strong> (OpenAI)
                  </td>
                  <td>
                    <Pill ok={aiStatus.cloud.available}>
                      {aiStatus.cloud.available ? 'configurada' : 'sin clave'}
                    </Pill>
                  </td>
                  <td>
                    <code>{aiStatus.cloud.model}</code>
                  </td>
                  <td>
                    <code>{aiStatus.cloud.visionModel}</code>
                  </td>
                </tr>
              </tbody>
            </table>
            {aiStatus.local.instalados && aiStatus.local.instalados.length > 0 && (
              <div className='muted small' style={{ marginTop: 10 }}>
                Descargados en Ollama: {aiStatus.local.instalados.join(', ')}
              </div>
            )}
            {/* El nombre del .env tiene que coincidir EXACTO con el de "ollama list":
                tener "qwen2.5-coder:7b" bajado y "qwen2.5:7b-instruct" en el .env
                falla con un 404 que no dice nada. */}
            {aiStatus.local.available &&
              (aiStatus.local.modelInstalado === false ||
                aiStatus.local.visionModelInstalado === false) && (
                <div className='notice notice--warn' style={{ marginTop: 14 }}>
                  Ollama está corriendo pero falta descargar{' '}
                  {[
                    aiStatus.local.modelInstalado === false ? aiStatus.local.model : null,
                    aiStatus.local.visionModelInstalado === false
                      ? aiStatus.local.visionModel
                      : null,
                  ]
                    .filter(Boolean)
                    .map(m => <code key={String(m)}>{m}</code>)
                    .reduce<React.ReactNode[]>(
                      (acc, el, i) => (i === 0 ? [el] : [...acc, ' y ', el]),
                      []
                    )}
                  . Corré <code>ollama pull NOMBRE</code>, o corregí{' '}
                  <code>OLLAMA_MODEL</code> / <code>OLLAMA_VISION_MODEL</code> en{' '}
                  <code>server/.env</code> para que coincidan exactamente con lo que muestra{' '}
                  <code>ollama list</code>.
                </div>
              )}
            {!aiStatus.local.available && !aiStatus.cloud.available && (
              <div className='notice notice--warn' style={{ marginTop: 14 }}>
                No hay ninguna IA disponible: el asistente y la importación por foto no van a
                funcionar. Levantá Ollama, o poné <code>OPENAI_API_KEY</code> en{' '}
                <code>server/.env</code>.
              </div>
            )}
          </>
        ) : (
          <p className='muted' style={{ margin: 0 }}>
            No se pudo consultar el estado de la IA (el servidor no responde).
          </p>
        )}
      </div>

      <div className='card'>
        <h3 className='card__title'>Identidad de esta sesión</h3>
        <div className='row'>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              background: identity.color,
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {identity.name.slice(0, 2).toUpperCase()}
          </span>
          <strong>{identity.name}</strong>
        </div>
        <div className='muted small' style={{ marginTop: 8 }}>
          clientId: <code>{identity.clientId}</code>
        </div>
      </div>

      <div className='card'>
        <h3 className='card__title'>Imágenes archivadas ({uploads.length})</h3>
        <p className='muted small' style={{ marginTop: 0 }}>
          Las fotos analizadas quedan guardadas en el servidor; sirven como anexo de la
          documentación.
        </p>
        <input className='input' type='file' accept='image/*' onChange={handleUpload} />
        {message && <p className='small'>{message}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          {uploads.map(u => (
            <a
              key={u.filename}
              href={api.fileUrl(u.url)}
              target='_blank'
              rel='noreferrer'
              style={{ width: 140, color: 'inherit', textDecoration: 'none' }}
            >
              <img
                src={api.fileUrl(u.url)}
                alt={u.filename}
                style={{
                  width: 140,
                  height: 100,
                  objectFit: 'cover',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                }}
              />
              <small className='muted' style={{ wordBreak: 'break-all' }}>
                {u.filename}
              </small>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Debug;
