import 'dotenv/config';

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * El secreto de firma no tiene valor por defecto a proposito: uno escrito en el
 * codigo es lo mismo que no firmar, porque cualquiera que vea el repositorio
 * puede emitir tokens validos. Generar uno con:
 *   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
 */
const secretoAuth = process.env.AUTH_SECRET ?? '';
if (secretoAuth === '' && process.env.AUTH_REQUIRED !== 'false') {
  throw new Error(
    'Falta AUTH_SECRET en server/.env. Genera uno con:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"\n' +
      'Para levantar el servidor sin autenticacion (solo desarrollo) usa AUTH_REQUIRED=false.'
  );
}

export const config = {
  port: num(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://case_user:case_pass@localhost:5433/case_db',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  /**
   * TLS contra la base de datos.
   *
   * Hace falta en cualquier Postgres administrado con IP publica (RDS de AWS,
   * Cloud SQL por IP, Neon, Supabase): rechazan la conexion sin cifrar, o la
   * aceptan en claro, que es peor. En local, con Postgres en la misma maquina o
   * por socket unix, no se usa.
   *
   * DATABASE_CA_FILE es el certificado de la autoridad del proveedor. Sin el,
   * la conexion va cifrada pero NO se verifica la identidad del servidor, asi
   * que un atacante en el medio podria hacerse pasar por la base. El servidor
   * avisa por consola cuando queda en ese modo.
   */
  databaseSsl: process.env.DATABASE_SSL === 'true',
  databaseCaFile: process.env.DATABASE_CA_FILE ?? '',
  /**
   * Carpeta con el frontend ya compilado. Si esta definida, el mismo proceso
   * sirve la API y la aplicacion.
   *
   * En la nube esto es lo que conviene: un solo servicio, un solo dominio. Con
   * el frontend en otro origen habria que configurar CORS con credenciales y el
   * WebSocket cruzado, que son dos cosas mas que pueden fallar el dia de la
   * demostracion. En desarrollo se deja vacio y Vite sirve el frontend.
   */
  staticDir: process.env.STATIC_DIR ?? '',
  auth: {
    secret: secretoAuth,
    /**
     * Perilla de emergencia. Con AUTH_REQUIRED=false el servidor deja pasar las
     * peticiones sin token, como antes de existir la autenticacion. Existe para
     * poder levantar el sistema si algo falla en una demostracion, no como modo
     * de uso: en la nube tiene que quedar en true.
     */
    requerida: process.env.AUTH_REQUIRED !== 'false',
    /**
     * Codigo de registro. Si esta definido, para crear una cuenta hay que
     * escribirlo.
     *
     * Existe porque en la nube la pantalla de registro queda expuesta a
     * internet: sin esto, cualquiera que encuentre la URL se crea una cuenta y
     * entra a crear pizarras. Con un codigo compartido con el equipo, el
     * registro sigue siendo de autoservicio (no hay que dar de alta a nadie a
     * mano) pero deja de estar abierto al mundo. Vacio = registro abierto, que
     * es lo comodo para desarrollo local.
     */
    codigoRegistro: process.env.REGISTRO_CODIGO ?? '',
  },
  ai: {
    strategy: (process.env.AI_STRATEGY ?? 'hybrid') as 'local' | 'cloud' | 'hybrid',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct',
    ollamaVisionModel: process.env.OLLAMA_VISION_MODEL ?? 'llama3.2-vision:11b',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    openaiVisionModel: process.env.OPENAI_VISION_MODEL ?? 'gpt-4o-mini',
  },
};
