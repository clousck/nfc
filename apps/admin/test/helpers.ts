import { fileURLToPath } from 'node:url';
import type { LinkRecord } from '@nfc/shared';
import type { MiddlewareHandler } from 'hono';
import { createApp } from '../server/app.js';
import type { LinkStore } from '../server/cloudflare.js';
import type { AppEnv } from '../server/context.js';
import { openDb } from '../server/db/client.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** KV en memoria; `failing = true` simula una caída de la API de Cloudflare. */
export class FakeLinkStore implements LinkStore {
  readonly data = new Map<string, LinkRecord>();
  failing = false;

  private check() {
    if (this.failing) throw new Error('Cloudflare API caída');
  }

  async putMany(entries: ReadonlyArray<{ slug: string; record: LinkRecord }>) {
    this.check();
    for (const { slug, record } of entries) this.data.set(slug, record);
  }

  async deleteMany(slugs: readonly string[]) {
    this.check();
    for (const slug of slugs) this.data.delete(slug);
  }

  async listSlugs() {
    this.check();
    return [...this.data.keys()];
  }
}

export function setup(auth: MiddlewareHandler<AppEnv> | null = null) {
  const { db, close } = openDb(':memory:', migrationsFolder);
  const store = new FakeLinkStore();
  const app = createApp({
    db,
    linkStore: store,
    publicBaseUrl: 'https://go.penginexr.com',
    auth,
  });

  async function request(method: string, path: string, body?: unknown, headers = {}) {
    return app.request(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function json<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
    const res = await request(method, path, body);
    return { status: res.status, body: (await res.json()) as T };
  }

  return { app, db, close, store, request, json };
}
