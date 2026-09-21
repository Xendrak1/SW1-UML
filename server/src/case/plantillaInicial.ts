import type { DiagramDoc } from '../types.js';

/**
 * PLANTILLA DE ARRANQUE DE UNA PIZARRA NUEVA
 *
 * El enunciado lo pide con estas palabras: "quien inicia la sesion, deberia
 * haber algun anfitrion, si uno inicia por primera vez no deberia estar en
 * blanco". Un lienzo vacio deja al anfitrion sin nada que mostrar ni sobre que
 * conversar en el primer minuto de la sesion.
 *
 * La plantilla es deliberadamente chica y generica -dos clases y una relacion
 * uno a muchos- por dos motivos: sirve de ejemplo de las tres cosas que hay que
 * saber para usar la herramienta (clase, atributos con tipo, relacion con
 * multiplicidades), y se borra en dos clics si el equipo va a modelar otra cosa.
 */
export function plantillaInicial(): DiagramDoc {
  const cliente = 'n_cliente';
  const pedido = 'n_pedido';

  return {
    nodes: [
      {
        id: cliente,
        type: 'default',
        position: { x: 120, y: 120 },
        data: {
          label: 'Cliente',
          attributes: [
            { id: `${cliente}_a1`, name: 'nombre', type: 'String', scope: 'private' },
            { id: `${cliente}_a2`, name: 'correo', type: 'String', scope: 'private' },
          ],
          asociativa: false,
        },
      },
      {
        id: pedido,
        type: 'default',
        position: { x: 520, y: 120 },
        data: {
          label: 'Pedido',
          attributes: [
            { id: `${pedido}_a1`, name: 'fecha', type: 'Date', scope: 'private' },
            { id: `${pedido}_a2`, name: 'total', type: 'Float', scope: 'private' },
          ],
          asociativa: false,
        },
      },
    ],
    edges: [
      {
        id: 'e_cliente_pedido',
        source: cliente,
        target: pedido,
        type: 'umlEdge',
        data: { edgeType: 'asociacion', sourceMultiplicity: '1', targetMultiplicity: '*' },
      },
    ],
    deleted: [],
  };
}
