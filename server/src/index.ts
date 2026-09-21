import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { pool, runMigrations, seedIfEmpty } from './db.js';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import { requiereSesion } from './auth/middleware.js';
import { caseRouter } from './routes/case.js';
import { boardsRouter } from './routes/boards.js';
import { uploadDir, uploadsRouter } from './routes/uploads.js';
import { attachWebSocketServer } from './ws.js';

const app = express();

app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map(s => s.trim()),
  })
);
app.use(express.json({ limit: '25mb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.use('/api/auth', authRouter);

/**
 * Todo /api exige sesion, menos el propio inicio de sesion.
 *
 * Va aca y no dentro de cada router porque es una regla del sistema, no de un
 * modulo: asi no se puede agregar un endpoint nuevo y olvidarse de protegerlo,
 * que es como quedan abiertas la mitad de las APIs.
 */
app.use('/api', (req, res, next) => {
  if (req.path === '/auth' || req.path.startsWith('/auth/')) {
    next();
    return;
  }
  requiereSesion(req, res, next);
});

app.use('/api', boardsRouter);
app.use('/api', uploadsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/case', caseRouter);
app.use('/files', express.static(uploadDir));

/**
 * Frontend compilado, cuando STATIC_DIR apunta a el.
 *
 * Va DESPUES de las rutas de API para no taparlas, y el comodin del final
 * devuelve index.html para cualquier ruta que no sea un archivo: la aplicacion
 * usa rutas del lado del cliente (/datos, /guia, /voz), y sin esto recargar la
 * pagina en una de ellas daria 404.
 */
if (config.staticDir !== '') {
  const raiz = resolve(process.cwd(), config.staticDir);
  app.use(express.static(raiz));
  app.get(/^(?!\/api|\/files|\/health|\/ws).*/, (_req, res) => {
    res.sendFile(join(raiz, 'index.html'));
  });
  console.log(`[http] sirviendo el frontend desde ${raiz}`);
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[http] error', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno' });
});

async function main() {
  await runMigrations();
  await seedIfEmpty();

  const server = createServer(app);
  attachWebSocketServer(server);

  // 0.0.0.0 para que la PWA del celular pueda conectarse por la red local.
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[http] servidor CASE en http://localhost:${config.port}`);
    console.log(`[ai]   estrategia: ${config.ai.strategy}`);
  });

  const shutdown = async () => {
    console.log('\n[server] cerrando...');
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[server] no se pudo iniciar:', err);
  process.exit(1);
});
