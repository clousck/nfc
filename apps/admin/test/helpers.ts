import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { LinkRecord } from '@nfc/shared';
import type { MiddlewareHandler } from 'hono';
import { createApp } from '../server/app.js';
import type { LinkStore, ScanStore } from '../server/cloudflare.js';
import type { AppEnv } from '../server/context.js';
import { openDb } from '../server/db/client.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const d1Migration = readFileSync(
  new URL('../../../infra/d1/migrations/0001_create_scans.sql', import.meta.url),
  'utf8',
);

/** D1 simulada: ejecuta el mismo SQL sobre SQLite en memoria con la migración real. */
export class FakeScanStore implements ScanStore {
  readonly sqlite = new Database(':memory:');
  failing = false;

  constructor() {
    this.sqlite.exec(d1Migration);
  }

  async query<T>(sql: string, params: ReadonlyArray<string | number> = []): Promise<T[]> {
    if (this.failing) throw new Error('D1 caída');
    return this.sqlite.prepare(sql).all(...params) as T[];
  }

  add(scan: {
    slug: string;
    ts: number;
    source?: 'nfc' | 'qr';
    os?: 'ios' | 'android' | 'other';
    city?: string;
    isBot?: boolean;
  }) {
    this.sqlite
      .prepare(
        'INSERT INTO scans (slug, ts, source, os, country, city, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        scan.slug,
        scan.ts,
        scan.source ?? 'nfc',
        scan.os ?? 'ios',
        'EC',
        scan.city ?? 'Ibarra',
        scan.isBot ? 1 : 0,
      );
  }
}

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
  const scans = new FakeScanStore();
  const app = createApp({
    db,
    linkStore: store,
    scanStore: scans,
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

  return {
    app,
    db,
    close: () => {
      close();
      scans.sqlite.close();
    },
    store,
    scans,
    request,
    json,
  };
}
