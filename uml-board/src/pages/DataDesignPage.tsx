import { saveAs } from 'file-saver';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBoards } from '../hooks/useDiagramSync';
import { flowEdgesToUml, flowNodesToUml } from '../lib/flowToUml';
import { ThemeToggle } from '../lib/theme';
import { useClassStore } from '../store/classStore';
import {
  analizarNormalizacion,
  construirModeloConceptual,
  generarDDL,
  generarInformeDisenoDatos,
  mapearARelacional,
  type DialectoSql,
} from '../utils/dataDesign';

/**
 * Pantalla de la fase de diseño de datos: modelo conceptual, mapeo con reglas de
 * Rumbaugh, esquema relacional, normalización y DDL. Todo derivado del diagrama
 * de clases que se está editando, de forma determinística y sin IA.
 */

type Pestana = 'conceptual' | 'mapeo' | 'esquema' | 'normalizacion' | 'ddl';

const PESTANAS: Array<{ id: Pestana; titulo: string }> = [
  { id: 'conceptual', titulo: '1. Modelo conceptual' },
  { id: 'mapeo', titulo: '2. Mapeo (Rumbaugh)' },
  { id: 'esquema', titulo: '3. Esquema relacional' },
  { id: 'normalizacion', titulo: '4. Normalización' },
  { id: 'ddl', titulo: '5. DDL' },
];

const DataDesignPage: React.FC = () => {
  const storeNodes = useClassStore(s => s.nodes);
  const storeEdges = useClassStore(s => s.edges);
  const loadDiagram = useClassStore(s => s.loadDiagram);
  const [pestana, setPestana] = useState<Pestana>('conceptual');
  const [dialecto, setDialecto] = useState<DialectoSql>('postgres');

  // Al entrar directo por la URL el store está vacío: hay que conectarse al
  // diagrama activo igual que hace la pizarra.
  const { boards } = useBoards();
  const cargadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (storeNodes.length > 0) return;
    const recordada = localStorage.getItem('case.boardId');
    const board = boards.find(b => b.id === recordada) ?? boards[0];
    if (!board || cargadoRef.current === board.diagram_id) return;
    cargadoRef.current = board.diagram_id;
    void loadDiagram(board.diagram_id);
  }, [boards, storeNodes.length, loadDiagram]);

  // Todo el análisis se recalcula solo cuando cambia el diagrama.
  const { conceptual, esquema, normalizacion, nodes, edges } = useMemo(() => {
    const umlNodes = flowNodesToUml(storeNodes);
    const umlEdges = flowEdgesToUml(storeEdges);
    const relacional = mapearARelacional(umlNodes, umlEdges);
    return {
      nodes: umlNodes,
      edges: umlEdges,
      conceptual: construirModeloConceptual(umlNodes, umlEdges),
      esquema: relacional,
      normalizacion: analizarNormalizacion(relacional),
    };
  }, [storeNodes, storeEdges]);

  const ddl = useMemo(() => generarDDL(esquema, dialecto), [esquema, dialecto]);

  const descargar = (contenido: string, nombre: string, mime: string) =>
    saveAs(new Blob([contenido], { type: `${mime};charset=utf-8` }), nombre);

  if (nodes.length === 0) {
    return (
      <div className='page'>
        <div className='page__head'>
          <h1 className='page__title'>Diseño de datos</h1>
          <Link to='/' className='btn'>
            ← Volver a la pizarra
          </Link>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
        </div>
        <div className='card'>
          <p className='muted' style={{ margin: 0 }}>
            No hay clases en el diagrama todavía. Volvé a la <Link to='/'>pizarra</Link> y modelá al
            menos una clase; el diseño de datos se deriva del diagrama de clases.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='page'>
      <div className='page__head'>
        <h1 className='page__title'>Diseño de datos</h1>
        <Link to='/' className='btn'>
          ← Volver a la pizarra
        </Link>
        <button
          className='btn btn--primary'
          onClick={() =>
            descargar(generarInformeDisenoDatos(nodes, edges), 'diseno-de-datos.md', 'text/markdown')
          }
        >
          Descargar informe (.md)
        </button>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
      </div>

      <p className='page__sub'>
        {nodes.length} clases y {edges.length} relaciones del diagrama actual. Todo lo de abajo se
        deriva del diagrama de forma determinística: no interviene la IA.
      </p>

      <div className='tabs'>
        {PESTANAS.map(p => (
          <button
            key={p.id}
            className={`tab${pestana === p.id ? ' tab--active' : ''}`}
            onClick={() => setPestana(p.id)}
          >
            {p.titulo}
          </button>
        ))}
      </div>

      <div className='card'>
        {pestana === 'conceptual' && (
          <>
            <h3 className='card__title'>Entidades</h3>
            <table className='table'>
              <thead>
                <tr>
                  <th>Entidad</th>
                  <th>Atributos</th>
                  <th>Clasificación</th>
                  <th>Especializa a</th>
                </tr>
              </thead>
              <tbody>
                {conceptual.entidades.map(e => (
                  <tr key={e.nombre}>
                    <td>
                      <strong>{e.nombre}</strong>
                    </td>
                    <td>{e.atributos.map(a => `${a.nombre}: ${a.tipo}`).join(', ') || '—'}</td>
                    <td>{e.asociativa ? 'asociativa' : e.debil ? 'débil' : 'fuerte'}</td>
                    <td>{e.especializaA ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className='card__title' style={{ marginTop: 26 }}>
              Relaciones
            </h3>
            <table className='table'>
              <thead>
                <tr>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Tipo</th>
                  <th>Cardinalidad</th>
                </tr>
              </thead>
              <tbody>
                {conceptual.relaciones.map((r, i) => (
                  <tr key={i}>
                    <td>{r.origen}</td>
                    <td>{r.destino}</td>
                    <td>{r.tipo}</td>
                    <td>
                      <strong>{r.cardinalidad}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {pestana === 'mapeo' && (
          <>
            <h3 className='card__title'>Reglas de transformación aplicadas</h3>
            <table className='table'>
              <thead>
                <tr>
                  <th>Regla</th>
                  <th>Elemento de origen</th>
                  <th>Resultado en el esquema</th>
                </tr>
              </thead>
              <tbody>
                {esquema.reglas.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <strong>{r.regla}</strong>
                    </td>
                    <td>{r.origen}</td>
                    <td>
                      <code>{r.resultado}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className='card__title' style={{ marginTop: 26 }}>
              Catálogo de reglas
            </h3>
            <ul className='muted' style={{ lineHeight: 1.8, paddingLeft: 20 }}>
              {[...new Map(esquema.reglas.map(r => [r.regla, r.descripcion]))]
                .sort()
                .map(([regla, desc]) => (
                  <li key={regla}>
                    <strong style={{ color: 'var(--text)' }}>{regla}:</strong> {desc}
                  </li>
                ))}
            </ul>
          </>
        )}

        {pestana === 'esquema' && (
          <>
            <h3 className='card__title'>{esquema.tablas.length} tablas</h3>
            {esquema.tablas.map(t => (
              <div key={t.nombre} style={{ marginBottom: 26 }}>
                <h4 style={{ margin: '0 0 3px' }}>
                  <code>{t.nombre}</code>
                </h4>
                <small className='muted'>{t.proveniencia}</small>
                <table className='table' style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>Columna</th>
                      <th>Tipo</th>
                      <th>Nulo</th>
                      <th>Clave</th>
                      <th>Referencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.columnas.map(c => (
                      <tr key={c.nombre}>
                        <td>
                          <code>{c.nombre}</code>
                        </td>
                        <td>{c.tipoSql}</td>
                        <td>{c.nulo ? 'sí' : 'no'}</td>
                        <td>{c.pk ? 'PK' : c.fk ? 'FK' : c.unica ? 'UNIQUE' : '—'}</td>
                        <td>
                          {c.fk ? (
                            <code>
                              {c.fk.tabla}.{c.fk.columna} ON DELETE {c.fk.onDelete}
                            </code>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}

        {pestana === 'normalizacion' && (
          <>
            <h3 className='card__title'>
              {normalizacion.resumen.evaluadas} tablas evaluadas — {normalizacion.resumen.en3FN} en
              3FN sin observaciones, {normalizacion.resumen.conObservaciones} con observaciones
            </h3>
            <p className='muted small'>
              Un diagrama de clases no declara las dependencias funcionales, así que además de lo que
              se deduce del esquema el análisis usa indicios estructurales. Cada observación viene
              justificada para poder discutirla o descartarla a mano.
            </p>

            {normalizacion.hallazgos
              .filter(h => !h.cumple)
              .map((h, i) => (
                <div key={i} className='notice notice--warn' style={{ marginBottom: 12 }}>
                  <strong>
                    <code>{h.tabla}</code> — {h.forma} no se cumple
                  </strong>
                  <p style={{ margin: '8px 0 4px' }}>{h.problema}</p>
                  <p className='small' style={{ margin: '4px 0', opacity: 0.85 }}>
                    {h.justificacion}
                  </p>
                  <p className='small' style={{ margin: '4px 0 0' }}>
                    <strong>Corrección propuesta:</strong> {h.sugerencia}
                  </p>
                </div>
              ))}

            <h4 style={{ marginTop: 24 }}>Detalle por tabla</h4>
            <table className='table'>
              <thead>
                <tr>
                  <th>Tabla</th>
                  <th>Forma normal</th>
                  <th>Cumple</th>
                  <th>Justificación</th>
                </tr>
              </thead>
              <tbody>
                {normalizacion.hallazgos.map((h, i) => (
                  <tr key={i}>
                    <td>
                      <code>{h.tabla}</code>
                    </td>
                    <td>{h.forma}</td>
                    <td
                      style={{
                        color: h.cumple ? 'var(--ok)' : 'var(--danger)',
                        fontWeight: 600,
                      }}
                    >
                      {h.cumple ? 'sí' : 'no'}
                    </td>
                    <td className='small'>{h.justificacion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {pestana === 'ddl' && (
          <>
            <div className='row' style={{ marginBottom: 14 }}>
              <button
                className={`btn${dialecto === 'postgres' ? ' btn--active' : ''}`}
                onClick={() => setDialecto('postgres')}
              >
                PostgreSQL
              </button>
              <button
                className={`btn${dialecto === 'mysql' ? ' btn--active' : ''}`}
                onClick={() => setDialecto('mysql')}
              >
                MySQL
              </button>
              <div style={{ flex: 1 }} />
              <button className='btn' onClick={() => void navigator.clipboard.writeText(ddl)}>
                Copiar
              </button>
              <button
                className='btn btn--primary'
                onClick={() => descargar(ddl, `esquema-${dialecto}.sql`, 'application/sql')}
              >
                Descargar .sql
              </button>
            </div>
            <pre style={{ maxHeight: '60vh' }}>{ddl}</pre>
          </>
        )}
      </div>
    </div>
  );
};

export default DataDesignPage;
