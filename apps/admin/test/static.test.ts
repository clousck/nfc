import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db/client.js';
import { FakeLinkStore } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'nfc-ui-'));
mkdirSync(join(dir, 'assets'));
writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');

const { db, close } = openDb(':memory:', fileURLToPath(new URL('../drizzle', import.meta.url)));
const app = createApp({
  db,
  linkStore: new FakeLinkStore(),
  scanStore: null,
  publicBaseUrl: 'https://go.penginexr.com',
  auth: null,
  staticDir: dir,
});

afterAll(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

describe('UI estática', () => {
  it('sirve index.html en la raíz', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('devuelve index.html para rutas de la SPA', async () => {
    const res = await app.request('/negocios/b_123');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('id="root"');
  });

  it('cachea para siempre los assets con hash', async () => {
    const res = await app.request('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('las rutas /api/* desconocidas siguen respondiendo JSON 404', async () => {
    const res = await app.request('/api/nada');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('la API sigue funcionando', async () => {
    const res = await app.request('/api/businesses');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
