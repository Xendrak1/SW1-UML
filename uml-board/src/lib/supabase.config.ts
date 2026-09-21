/**
 * OBSOLETO. Este archivo existia para conectarse a un proyecto Supabase ajeno,
 * con la URL y la clave escritas en el codigo.
 *
 * La persistencia y la colaboracion ahora corren en el backend propio (carpeta server/)
 * sobre Postgres local. Ver:
 *   - src/lib/apiClient.ts    (REST)
 *   - src/lib/collabClient.ts (WebSocket colaborativo + cola offline)
 *   - src/lib/env.ts          (configuracion por variables de entorno)
 *
 * Se conserva solo para que las rutas de importacion antiguas fallen con un mensaje claro.
 */
export {};
