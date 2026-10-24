import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { cloudflareAccess } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { createHttpEdgeClient, createUnconfiguredEdgeClient } from './edge-client.js';
import { createPublisher } from './publisher.js';

// Tanto en `server/index.ts` (tsx) como en `dist/index.js` (build) queda en ../drizzle.
const migrationsFolder =
  process.env['MIGRATIONS_DIR'] ?? fileURLToPath(new URL('../drizzle', import.meta.url));

// UI compilada por Vite en dist/public (solo existe tras `pnpm build`).
const staticDir = fileURLToPath(new URL('./public', import.meta.url));

const config = loadConfig();
const { db, close } = openDb(config.databasePath, migrationsFolder);

if (!config.edge) {
  console.warn('[admin] Falta INTERNAL_API_TOKEN: los cambios quedan en cola hasta configurarlo.');
}
if (!config.access) {
  console.warn('[admin] AUTH_DISABLED=true: la API no valida Cloudflare Access.');
}

const edge = config.edge ? createHttpEdgeClient(config.edge) : createUnconfiguredEdgeClient();
const publisher = createPublisher({ db, edge });
const stopRetries = publisher.start();

const app = createApp({
  db,
  edge,
  publisher,
  publicBaseUrl: config.publicBaseUrl,
  auth: config.access ? cloudflareAccess(config.access) : null,
  log: true,
  staticDir: existsSync(staticDir) ? staticDir : null,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[admin] Escuchando en http://localhost:${info.port}`);
});

function shutdown(signal: string) {
  console.log(`[admin] ${signal} recibido, cerrando…`);
  stopRetries();
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
