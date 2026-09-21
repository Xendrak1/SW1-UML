import { pool, runMigrations, seedIfEmpty } from './db.js';

await runMigrations();
await seedIfEmpty();
console.log('[migrate] listo');
await pool.end();
