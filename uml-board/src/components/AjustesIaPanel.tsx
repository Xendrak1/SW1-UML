import React, { useEffect, useState } from 'react';
import {
  AJUSTES_POR_DEFECTO,
  PROVEEDORES,
  guardarAjustesIa,
  leerAjustesIa,
  type AjustesIa,
} from '../lib/ajustesIa';
import { modelosLocales, ollamaDisponible } from '../lib/iaRelevo';

/**
 * Donde el usuario elige de donde sale la IA.
 *
 * Es la pantalla que faltaba: hasta ahora la IA la decidia el servidor con una
 * clave suya, y en la nube eso significa que el consumo de todos va a la misma
 * cuenta y que la "IA local" del enunciado no existe, porque en un servidor de
 * AWS no hay ningun Ollama.
 *
 * Las tres opciones no son equivalentes y la pantalla lo dice en vez de
 * esconderlo: la local es gratis y privada pero hay que tenerla instalada; la
 * de la nube funciona en cualquier maquina pero se paga y el diagrama sale de
 * aca; y sin IA la herramienta sigue sirviendo para modelar a mano.
 */

interface Props {
  onCerrar: () => void;
}

const AjustesIaPanel: React.FC<Props> = ({ onCerrar }) => {
  const [a, setA] = useState<AjustesIa>(() => leerAjustesIa());
  const [sondeando, setSondeando] = useState(false);
  const [local, setLocal] = useState<{ vivo: boolean; modelos: string[] } | null>(null);
  const [guardado, setGuardado] = useState(false);

  const cambiar = <K extends keyof AjustesIa>(k: K, v: AjustesIa[K]) => {
    setA(prev => ({ ...prev, [k]: v }));
    setGuardado(false);
  };

  const probarLocal = async () => {
    setSondeando(true);
    try {
      const vivo = await ollamaDisponible(a.ollamaUrl);
      setLocal({ vivo, modelos: vivo ? await modelosLocales(a.ollamaUrl) : [] });
    } finally {
      setSondeando(false);
    }
  };

  // Se sondea al abrir: saber si Ollama esta corriendo es la primera pregunta
  // que tiene el usuario, y hacersela responder con un boton es pereza nuestra.
  useEffect(() => {
    void probarLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guardar = () => {
    guardarAjustesIa(a);
    setGuardado(true);
  };

  const proveedor = PROVEEDORES.find(p => p.baseUrl === a.baseUrlNube);

  return (
    <div className='overlay' onClick={onCerrar}>
      <div className='modal' onClick={e => e.stopPropagation()}>
        <div className='modal__head'>
          <h2 className='modal__title'>Ajustes de IA</h2>
        </div>
        <p className='ajustes__intro'>
          Elegí de dónde sale la inteligencia artificial. El servidor siempre arma las
          instrucciones y revisa lo que el modelo contesta; lo único que cambia es quién
          ejecuta el modelo.
        </p>

        <fieldset className='ajustes__grupo'>
          <legend>Modo</legend>

          <label className='ajustes__opcion'>
            <input
              type='radio'
              name='modo-ia'
              checked={a.modo === 'auto'}
              onChange={() => cambiar('modo', 'auto')}
            />
            <span>
              <strong>Automático</strong>
              <small>
                Usa tu Ollama si está corriendo; si no, tu clave de la nube; y si no hay
                ninguna, lo que tenga configurado el servidor.
              </small>
            </span>
          </label>

          <label className='ajustes__opcion'>
            <input
              type='radio'
              name='modo-ia'
              checked={a.modo === 'local'}
              onChange={() => cambiar('modo', 'local')}
            />
            <span>
              <strong>IA local (tu Ollama)</strong>
              <small>
                Gratis y sin mandar el diagrama a nadie. El modelo corre en esta máquina y
                es tu navegador el que le habla: el servidor en la nube no puede alcanzarlo.
              </small>
            </span>
          </label>

          <label className='ajustes__opcion'>
            <input
              type='radio'
              name='modo-ia'
              checked={a.modo === 'nube'}
              onChange={() => cambiar('modo', 'nube')}
            />
            <span>
              <strong>IA en la nube (tu clave)</strong>
              <small>
                Funciona en cualquier máquina, incluido el teléfono. La clave viaja sólo en
                la petición de IA y el servidor no la guarda.
              </small>
            </span>
          </label>

          <label className='ajustes__opcion'>
            <input
              type='radio'
              name='modo-ia'
              checked={a.modo === 'sin-ia'}
              onChange={() => cambiar('modo', 'sin-ia')}
            />
            <span>
              <strong>Sin IA</strong>
              <small>
                Modelado a mano. Las órdenes simples escritas siguen funcionando con el
                intérprete que corre en el navegador, sin ningún modelo.
              </small>
            </span>
          </label>
        </fieldset>

        {(a.modo === 'local' || a.modo === 'auto') && (
          <fieldset className='ajustes__grupo'>
            <legend>Tu Ollama</legend>
            <label className='ajustes__campo'>
              <span>Dirección</span>
              <input
                value={a.ollamaUrl}
                onChange={e => cambiar('ollamaUrl', e.target.value)}
                placeholder='http://localhost:11434'
              />
            </label>
            <label className='ajustes__campo'>
              <span>Modelo de texto</span>
              <input
                value={a.ollamaModelo}
                onChange={e => cambiar('ollamaModelo', e.target.value)}
                list='modelos-locales'
              />
            </label>
            <label className='ajustes__campo'>
              <span>Modelo de visión</span>
              <input
                value={a.ollamaModeloVision}
                onChange={e => cambiar('ollamaModeloVision', e.target.value)}
                list='modelos-locales'
              />
            </label>
            <datalist id='modelos-locales'>
              {(local?.modelos ?? []).map(m => (
                <option key={m} value={m} />
              ))}
            </datalist>

            <div className='ajustes__estado'>
              <button type='button' className='btn' onClick={probarLocal} disabled={sondeando}>
                {sondeando ? 'Probando…' : 'Probar conexión'}
              </button>
              {local && local.vivo && (
                <span className='ajustes__ok'>
                  Responde. Modelos descargados: {local.modelos.join(', ') || 'ninguno'}
                </span>
              )}
              {local && !local.vivo && (
                <span className='ajustes__mal'>
                  No responde. Levantalo con <code>ollama serve</code> y permitile esta
                  página:{' '}
                  <code>
                    OLLAMA_ORIGINS={typeof window !== 'undefined' ? window.location.origin : ''}
                  </code>
                </span>
              )}
            </div>
          </fieldset>
        )}

        {(a.modo === 'nube' || a.modo === 'auto') && (
          <fieldset className='ajustes__grupo'>
            <legend>Tu proveedor en la nube</legend>
            <label className='ajustes__campo'>
              <span>Proveedor</span>
              <select
                value={proveedor?.id ?? 'otro'}
                onChange={e => {
                  const p = PROVEEDORES.find(x => x.id === e.target.value);
                  if (!p) return;
                  setA(prev => ({
                    ...prev,
                    baseUrlNube: p.baseUrl,
                    modeloNube: p.modelo,
                    modeloNubeVision: p.modeloVision,
                  }));
                  setGuardado(false);
                }}
              >
                {PROVEEDORES.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
                <option value='otro'>Otro compatible con OpenAI</option>
              </select>
            </label>
            <label className='ajustes__campo'>
              <span>Endpoint</span>
              <input
                value={a.baseUrlNube}
                onChange={e => cambiar('baseUrlNube', e.target.value)}
                placeholder='https://…/v1/chat/completions'
              />
            </label>
            <label className='ajustes__campo'>
              <span>Clave</span>
              <input
                type='password'
                value={a.claveNube}
                onChange={e => cambiar('claveNube', e.target.value)}
                placeholder='sk-…'
                autoComplete='off'
              />
            </label>
            <label className='ajustes__campo'>
              <span>Modelo</span>
              <input value={a.modeloNube} onChange={e => cambiar('modeloNube', e.target.value)} />
            </label>
            <label className='ajustes__opcion'>
              <input
                type='checkbox'
                checked={a.recordarClave}
                onChange={e => cambiar('recordarClave', e.target.checked)}
              />
              <span>
                <strong>Recordar la clave en este navegador</strong>
                <small>
                  Queda guardada en este equipo y cualquier script de esta página puede
                  leerla. Si estás en una máquina compartida, desmarcá esto: la clave vivirá
                  sólo hasta que cierres la pestaña.
                </small>
              </span>
            </label>
          </fieldset>
        )}

        <div className='modal__foot'>
          <button
            type='button'
            className='btn'
            onClick={() => {
              setA({ ...AJUSTES_POR_DEFECTO });
              setGuardado(false);
            }}
          >
            Restablecer
          </button>
          <button type='button' className='btn' onClick={onCerrar}>
            Cerrar
          </button>
          <button type='button' className='btn btn--primary' onClick={guardar}>
            {guardado ? 'Guardado' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AjustesIaPanel;
