import { valorEjemplo, type EntidadJava, type ModeloJava } from './backendModel';

/**
 * Coleccion de Postman para probar el backend generado.
 *
 * Deriva del mismo modelo Java que el generador de entidades, no de una segunda
 * interpretacion del diagrama. Eso importa para los cuerpos de las peticiones:
 * como las relaciones se generan como asociaciones JPA, el JSON lleva la entidad
 * anidada ({"empresa": {"id": 1}}) y no un identificador suelto. Con dos
 * interpretaciones distintas, la coleccion enviaba un cuerpo que el backend no
 * aceptaba.
 */

const PUERTO = '8080';
const HOST = 'localhost';

/** Ruta REST de una entidad, igual que la que emite el controlador generado. */
const rutaDe = (entidad: EntidadJava): string => `${entidad.label.toLowerCase()}s`;

function cuerpoEjemplo(entidad: EntidadJava, actualizacion = false): string {
  const cuerpo: Record<string, unknown> = {};
  for (const campo of entidad.campos) {
    // El identificador lo asigna la base de datos.
    if (campo.clase === 'id') continue;
    if (actualizacion && campo.clase === 'basic' && campo.javaType === 'String') {
      cuerpo[campo.javaName] = 'valor actualizado';
      continue;
    }
    cuerpo[campo.javaName] = valorEjemplo(campo);
  }
  return JSON.stringify(cuerpo, null, 2);
}

const url = (ruta: string, conId = false) => ({
  raw: `http://${HOST}:${PUERTO}/${ruta}${conId ? '/1' : ''}`,
  protocol: 'http',
  host: [HOST],
  port: PUERTO,
  path: conId ? [ruta, '1'] : [ruta],
});

const cabeceras = [{ key: 'Content-Type', value: 'application/json' }];

export function generatePostmanCollection(modelo: ModeloJava): string {
  const collection = {
    info: {
      name: 'DemoAPI',
      description:
        'Operaciones CRUD generadas a partir del diagrama de clases. Las relaciones se ' +
        'envian como objeto anidado con su id, por ejemplo {"empresa": {"id": 1}}. ' +
        'Antes de ejecutar POST sobre una entidad con relaciones obligatorias, crear primero ' +
        'la entidad referenciada.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _postman_id: 'demo-api-collection',
    },
    // Una carpeta por entidad: en Postman se navega mucho mejor que una lista plana.
    item: [] as Record<string, unknown>[],
  };

  for (const entidad of modelo.entidades) {
    const ruta = rutaDe(entidad);
    const relaciones = entidad.campos.filter(c => c.clase === 'fk');

    collection.item.push({
      name: entidad.label,
      description:
        relaciones.length > 0
          ? `Requiere que existan: ${relaciones.map(r => r.targetEntity).join(', ')}.`
          : 'Sin dependencias.',
      item: [
        {
          name: `Listar ${entidad.label}`,
          request: { method: 'GET', header: [], url: url(ruta) },
        },
        {
          name: `Obtener ${entidad.label} por id`,
          request: { method: 'GET', header: [], url: url(ruta, true) },
        },
        {
          name: `Crear ${entidad.label}`,
          request: {
            method: 'POST',
            header: cabeceras,
            body: { mode: 'raw', raw: cuerpoEjemplo(entidad), options: { raw: { language: 'json' } } },
            url: url(ruta),
          },
        },
        {
          name: `Actualizar ${entidad.label}`,
          request: {
            method: 'PUT',
            header: cabeceras,
            body: {
              mode: 'raw',
              raw: cuerpoEjemplo(entidad, true),
              options: { raw: { language: 'json' } },
            },
            url: url(ruta, true),
          },
        },
        {
          name: `Eliminar ${entidad.label}`,
          request: { method: 'DELETE', header: [], url: url(ruta, true) },
        },
      ],
    });
  }

  return JSON.stringify(collection, null, 2);
}
