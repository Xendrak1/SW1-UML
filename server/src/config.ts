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
  auth: {
    secret: secretoAuth,
    /**
     * Perilla de emergencia. Con AUTH_REQUIRED=false el servidor deja pasar las
     * peticiones sin token, como antes de existir la autenticacion. Existe para
     * poder levantar el sistema si algo falla en una demostracion, no como modo
     * de uso: en la nube tiene que quedar en true.
     */
    requerida: process.env.AUTH_REQUIRED !== 'false',
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
