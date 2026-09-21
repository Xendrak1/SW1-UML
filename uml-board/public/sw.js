/**
 * Service worker de la PWA.
 *
 * Su unica responsabilidad es que el armazon de la aplicacion arranque sin
 * conexion. Los datos del diagrama NO pasan por aca: viven en IndexedDB y se
 * sincronizan por WebSocket (ver src/lib/offlineQueue.ts y collabClient.ts).
 *
 * Detalle que costo un defecto real: no alcanza con precachear index.html. En la
 * primera visita el navegador descarga el HTML y el bundle ANTES de que este
 * service worker se active, asi que el bundle no queda en esta cache. Al recargar
 * sin conexion se servia el HTML pero el script fallaba y la pantalla quedaba en
 * blanco; a veces parecia funcionar solo porque la cache HTTP del navegador
 * todavia tenia el archivo, lo que hacia el problema intermitente.
 *
 * La solucion es leer index.html durante la instalacion, extraer las URLs de los
 * recursos que referencia y cachearlas todas. Asi no hace falta conocer de
 * antemano los nombres con hash que genera el empaquetador.
 *
 * Segundo detalle, que causaba el mismo sintoma aunque el recurso YA estuviera
 * guardado: la busqueda en la cache respeta el encabezado Vary de la respuesta.
 * El servidor responde con Vary, y los encabezados de la peticion de un modulo
 * no son identicos a los de la peticion con la que se precacheo, asi que
 * cache.match devolvia vacio y el bundle no se servia. Por eso todas las
 * busquedas usan ignoreVary, y tambien ignoreSearch para que un parametro de
 * consulta no invalide la copia.
 */

/** Opciones de busqueda: sin esto, un Vary del servidor invalida la copia local. */
const COINCIDENCIA = { ignoreVary: true, ignoreSearch: true };

const CACHE = 'case-uml-v3';
const ARMAZON = ['/', '/index.html', '/manifest.webmanifest'];

/** Recursos que index.html referencia: <script src>, <link href>. */
async function recursosDelIndice() {
  try {
    const res = await fetch('/index.html', { cache: 'reload' });
    if (!res.ok) return [];
    const html = await res.text();
    const urls = new Set();
    const patron = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = patron.exec(html)) !== null) {
      const url = m[1];
      // Solo recursos propios y absolutos: nada de CDNs ni de data:
      if (url.startsWith('/') && !url.startsWith('//')) urls.add(url);
    }
    return [...urls];
  } catch {
    return [];
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const recursos = await recursosDelIndice();
      // addAll falla entero si un solo recurso falla, asi que se cachea de a uno.
      // Se guarda con cache.put y una peticion simple, para que la copia no quede
      // atada a los encabezados de una peticion particular.
      await Promise.all(
        [...new Set([...ARMAZON, ...recursos])].map(async url => {
          try {
            const respuesta = await fetch(url, { cache: 'reload' });
            if (respuesta.ok) await cache.put(new Request(url), respuesta);
          } catch {
            /* un recurso que no se pueda guardar no debe abortar la instalacion */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const claves = await caches.keys();
      await Promise.all(claves.filter(c => c !== CACHE).map(c => caches.delete(c)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Solo se atiende el propio origen: la API va a otro host y no debe cachearse.
  if (url.origin !== self.location.origin) return;
  // Las llamadas al backend nunca se cachean: si no hay red, la cola offline se encarga.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/files')) return;

  // Navegacion: red primero, y el armazon cacheado como respaldo. Es lo que
  // permite abrir la aplicacion sin conexion.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match('/index.html', COINCIDENCIA)) ??
            (await cache.match('/', COINCIDENCIA)) ??
            new Response(
              '<!doctype html><meta charset="utf-8"><title>Sin conexión</title>' +
                '<p style="font-family:system-ui;padding:2rem">No hay conexión y la aplicación ' +
                'todavía no quedó guardada en este dispositivo. Volvé a abrirla con red al menos una vez.</p>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
            )
          );
        }
      })()
    );
    return;
  }

  // Recursos estaticos: cache primero, y se refresca en segundo plano.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cacheada = await cache.match(request, COINCIDENCIA);

      const desdeRed = fetch(request)
        .then(respuesta => {
          // Se reescribe la clave a una peticion simple, por el mismo motivo del Vary.
          if (respuesta.ok) void cache.put(new Request(request.url), respuesta.clone());
          return respuesta;
        })
        .catch(() => undefined);

      if (cacheada) {
        // Se actualiza en segundo plano sin bloquear la respuesta.
        void desdeRed;
        return cacheada;
      }

      const respuesta = await desdeRed;
      if (respuesta) return respuesta;
      // Sin cache y sin red: se responde con un error explicito en vez de colgar.
      return new Response('', { status: 504, statusText: 'Sin conexión y sin copia local' });
    })()
  );
});
