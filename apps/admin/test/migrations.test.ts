import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Copia de las migraciones con el journal recortado a las `count` primeras. */
function firstMigrations(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'nfc-mig-'));
  dirs.push(dir);
  cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migración 0001_tag_number', () => {
  it('numera los chips existentes por orden de creación y deja el contador listo', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);

    migrate(db, { migrationsFolder: firstMigrations(1) });
    sqlite.exec(`
      INSERT INTO businesses (id, name, created_at) VALUES ('b_0123456789ab', 'Café X', 1);
      INSERT INTO tags (slug, business_id, type, target_url, created_at) VALUES
        ('ccccccc', NULL, 'redirect', NULL, 300),
        ('aaaaaaa', 'b_0123456789ab', 'redirect', 'https://x.com', 100),
        ('bbbbbbb', NULL, 'redirect', NULL, 200);
    `);

    migrate(db, { migrationsFolder });

    const rows = sqlite
      .prepare('SELECT slug, number, business_id, target_url FROM tags ORDER BY number')
      .all();
    expect(rows).toEqual([
      { slug: 'aaaaaaa', number: 1, business_id: 'b_0123456789ab', target_url: 'https://x.com' },
      { slug: 'bbbbbbb', number: 2, business_id: null, target_url: null },
      { slug: 'ccccccc', number: 3, business_id: null, target_url: null },
    ]);
    expect(sqlite.prepare('SELECT last FROM tag_counter').get()).toEqual({ last: 3 });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });

  it('en una base vacía el contador empieza en 0', () => {
    const sqlite = new Database(':memory:');
    migrate(drizzle(sqlite), { migrationsFolder });
    expect(sqlite.prepare('SELECT last FROM tag_counter').get()).toEqual({ last: 0 });
    sqlite.close();
  });
});
