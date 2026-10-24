import {
  businessOwner,
  projectAll,
  projectBusiness,
  projectTag,
  tagOwner,
  type ApplyResponse,
  type BusinessState,
  type KvValue,
  type SyncBody,
  type SyncResponse,
  type TagState,
} from '@nfc/shared';
import type { Env } from '../env.js';

// Copia del plano de control en D1 y publicación en KV. El Worker es el único que escribe
// en KV: recalcula las claves de cada "dueño" afectado y escribe solo las que cambian.
//
// Límites del plan gratis que condicionan el código: 50 consultas D1 por invocación y 100
// parámetros por consulta (por eso las escrituras van en INSERT de varias filas), y 1.000
// escrituras KV al día (por eso se compara con kv_published antes de escribir).

const MAX_PARAMS = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

interface BusinessRow {
  id: string;
  name: string;
  status: BusinessState['status'];
  report_token: string | null;
  loyalty_visits: number | null;
  revision: number;
  deleted: number;
}

interface TagRow {
  slug: string;
  number: number;
  business_id: string | null;
  assigned_at: number | null;
  label: string | null;
  type: TagState['type'];
  target_url: string | null;
  active: number;
  revision: number;
  deleted: number;
}

const toBusiness = (r: BusinessRow): BusinessState => ({
  id: r.id,
  name: r.name,
  status: r.status,
  reportToken: r.report_token,
  loyaltyVisits: r.loyalty_visits,
});

const toTag = (r: TagRow): TagState => ({
  slug: r.slug,
  number: r.number,
  businessId: r.business_id,
  assignedAt: r.assigned_at,
  label: r.label,
  type: r.type,
  targetUrl: r.target_url,
  active: r.active === 1,
});

type Value = string | number | null;

const BUSINESS_COLUMNS = ['id', 'name', 'status', 'report_token', 'loyalty_visits', 'revision'];
const businessValues = (b: BusinessState, revision: number): Value[] => [
  b.id,
  b.name,
  b.status,
  b.reportToken,
  b.loyaltyVisits,
  revision,
];

const TAG_COLUMNS = [
  'slug',
  'number',
  'business_id',
  'assigned_at',
  'label',
  'type',
  'target_url',
  'active',
  'revision',
];
const tagValues = (t: TagState, revision: number): Value[] => [
  t.slug,
  t.number,
  t.businessId,
  t.assignedAt,
  t.label,
  t.type,
  t.targetUrl,
  t.active ? 1 : 0,
  revision,
];

/**
 * INSERT de varias filas que solo pisa una fila existente si la revisión nueva es mayor
 * (o igual, en la sincronización completa, que es la fuente de verdad en ese instante).
 */
function upserts(
  db: D1Database,
  table: 'business_profile' | 'tag_inventory',
  columns: string[],
  rows: Value[][],
  allowEqual: boolean,
): D1PreparedStatement[] {
  const width = columns.length + 1; // + deleted
  const updates = [...columns.slice(1), 'deleted'].map((col) => `${col} = excluded.${col}`);
  const guard = `excluded.revision ${allowEqual ? '>=' : '>'} ${table}.revision`;
  return chunk(rows, Math.floor(MAX_PARAMS / width)).map((part) =>
    db
      .prepare(
        `INSERT INTO ${table} (${columns.join(', ')}, deleted)
         VALUES ${part.map(() => `(${placeholders(width)})`).join(', ')}
         ON CONFLICT(${columns[0]}) DO UPDATE SET ${updates.join(', ')} WHERE ${guard}`,
      )
      .bind(...part.flatMap((values) => [...values, 0])),
  );
}

/** Lápida: marca el borrado con su revisión para que un envío atrasado no lo resucite. */
function tombstone(
  db: D1Database,
  table: 'business_profile' | 'tag_inventory',
  id: string,
  revision: number,
): D1PreparedStatement {
  const insert =
    table === 'business_profile'
      ? `INSERT INTO business_profile (id, name, status, revision, deleted) VALUES (?, '', 'cancelled', ?, 1)`
      : `INSERT INTO tag_inventory (slug, number, type, active, revision, deleted) VALUES (?, 0, 'redirect', 0, ?, 1)`;
  const key = table === 'business_profile' ? 'id' : 'slug';
  return db
    .prepare(
      `${insert} ON CONFLICT(${key}) DO UPDATE SET deleted = 1, revision = excluded.revision
       WHERE excluded.revision > ${table}.revision`,
    )
    .bind(id, revision);
}

interface Published {
  owner: string;
  value: string;
}

type Desired = Map<string, { owner: string; value: KvValue }>;

/**
 * Escribe en KV solo las diferencias entre lo deseado y lo publicado, y registra en
 * kv_published lo que sí llegó a KV (aunque falle a mitad, lo hecho queda anotado).
 */
async function applyKv(
  env: Env,
  desired: Desired,
  current: Map<string, Published>,
): Promise<{ written: number; deleted: number }> {
  const upserted: Value[][] = [];
  const removed: string[] = [];
  try {
    for (const [key, { owner, value }] of desired) {
      const json = JSON.stringify(value);
      const prev = current.get(key);
      if (prev && prev.value === json && prev.owner === owner) continue;
      await env.LINKS.put(key, json);
      upserted.push([key, owner, json]);
    }
    for (const key of current.keys()) {
      if (desired.has(key)) continue;
      await env.LINKS.delete(key);
      removed.push(key);
    }
  } finally {
    const statements = [
      ...chunk(upserted, Math.floor(MAX_PARAMS / 3)).map((part) =>
        env.DB.prepare(
          `INSERT INTO kv_published (key, owner, value) VALUES ${part.map(() => '(?, ?, ?)').join(', ')}
           ON CONFLICT(key) DO UPDATE SET owner = excluded.owner, value = excluded.value`,
        ).bind(...part.flat()),
      ),
      ...chunk(removed, MAX_PARAMS).map((part) =>
        env.DB.prepare(`DELETE FROM kv_published WHERE key IN (${placeholders(part.length)})`).bind(
          ...part,
        ),
      ),
    ];
    if (statements.length > 0) await env.DB.batch(statements);
  }
  return { written: upserted.length, deleted: removed.length };
}

async function publishedOf(db: D1Database, owners: string[]): Promise<Map<string, Published>> {
  const out = new Map<string, Published>();
  for (const part of chunk(owners, MAX_PARAMS)) {
    const { results } = await db
      .prepare(
        `SELECT key, owner, value FROM kv_published WHERE owner IN (${placeholders(part.length)})`,
      )
      .bind(...part)
      .all<{ key: string } & Published>();
    for (const row of results) out.set(row.key, { owner: row.owner, value: row.value });
  }
  return out;
}

/**
 * Recalcula las claves de los negocios indicados (sus datos, su enlace de estadísticas y
 * todos sus chips) y de los chips indicados, y publica las diferencias.
 */
async function publishOwners(
  env: Env,
  businessIds: readonly string[],
  slugs: readonly string[],
): Promise<{ written: number; deleted: number }> {
  const ids = [...new Set(businessIds)];
  const [businessRows, tagRows] = await Promise.all([
    ids.length > 0
      ? env.DB.prepare(
          `SELECT * FROM business_profile WHERE deleted = 0 AND id IN (${placeholders(ids.length)})`,
        )
          .bind(...ids)
          .all<BusinessRow>()
      : Promise.resolve({ results: [] as BusinessRow[] }),
    ids.length + slugs.length > 0
      ? env.DB.prepare(
          `SELECT * FROM tag_inventory WHERE deleted = 0 AND (${[
            ids.length > 0 ? `business_id IN (${placeholders(ids.length)})` : null,
            slugs.length > 0 ? `slug IN (${placeholders(slugs.length)})` : null,
          ]
            .filter(Boolean)
            .join(' OR ')})`,
        )
          .bind(...ids, ...slugs)
          .all<TagRow>()
      : Promise.resolve({ results: [] as TagRow[] }),
  ]);
  const businesses = businessRows.results.map(toBusiness);
  const tags = tagRows.results.map(toTag);
  const byId = new Map(businesses.map((b) => [b.id, b]));

  const desired: Desired = new Map();
  for (const business of businesses) {
    for (const entry of projectBusiness(business, tags)) {
      desired.set(entry.key, { owner: businessOwner(business.id), value: entry.value });
    }
  }
  for (const tag of tags) {
    const record = projectTag(tag, tag.businessId ? (byId.get(tag.businessId) ?? null) : null);
    if (record) desired.set(tag.slug, { owner: tagOwner(tag.slug), value: record });
  }

  const owners = [
    ...ids.map(businessOwner),
    ...new Set([...slugs, ...tags.map((t) => t.slug)].map(tagOwner)),
  ];
  return applyKv(env, desired, await publishedOf(env.DB, owners));
}

async function tagRow(db: D1Database, slug: string): Promise<TagRow | null> {
  return db.prepare('SELECT * FROM tag_inventory WHERE slug = ?').bind(slug).first<TagRow>();
}

async function businessRow(db: D1Database, id: string): Promise<BusinessRow | null> {
  return db.prepare('SELECT * FROM business_profile WHERE id = ?').bind(id).first<BusinessRow>();
}

const NOT_APPLIED: ApplyResponse = { applied: false, written: 0, deleted: 0 };

export async function putTag(env: Env, tag: TagState, revision: number): Promise<ApplyResponse> {
  const old = await tagRow(env.DB, tag.slug);
  if (old && old.revision >= revision) return NOT_APPLIED;
  await env.DB.batch(
    upserts(env.DB, 'tag_inventory', TAG_COLUMNS, [tagValues(tag, revision)], false),
  );
  // El negocio anterior también cambia: su enlace de estadísticas pierde el chip.
  const affected = [old && !old.deleted ? old.business_id : null, tag.businessId];
  const result = await publishOwners(
    env,
    affected.filter((id): id is string => !!id),
    [tag.slug],
  );
  return { applied: true, ...result };
}

export async function deleteTag(env: Env, slug: string, revision: number): Promise<ApplyResponse> {
  const old = await tagRow(env.DB, slug);
  if (old && old.revision >= revision) return NOT_APPLIED;
  await env.DB.batch([tombstone(env.DB, 'tag_inventory', slug, revision)]);
  const affected = old && !old.deleted && old.business_id ? [old.business_id] : [];
  return { applied: true, ...(await publishOwners(env, affected, [slug])) };
}

export async function putBusiness(
  env: Env,
  business: BusinessState,
  revision: number,
): Promise<ApplyResponse> {
  const old = await businessRow(env.DB, business.id);
  if (old && old.revision >= revision) return NOT_APPLIED;
  await env.DB.batch(
    upserts(
      env.DB,
      'business_profile',
      BUSINESS_COLUMNS,
      [businessValues(business, revision)],
      false,
    ),
  );
  // Un token regenerado deja el report:<viejo> sin producir: applyKv lo borra.
  return { applied: true, ...(await publishOwners(env, [business.id], [])) };
}

export async function deleteBusiness(
  env: Env,
  id: string,
  revision: number,
): Promise<ApplyResponse> {
  const old = await businessRow(env.DB, id);
  if (old && old.revision >= revision) return NOT_APPLIED;
  await env.DB.batch([tombstone(env.DB, 'business_profile', id, revision)]);
  return { applied: true, ...(await publishOwners(env, [id], [])) };
}

async function listAllKvKeys(kv: KVNamespace): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list(cursor ? { cursor } : {});
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

/**
 * "Re-sincronizar todo": la foto de la Pi reemplaza la copia (lo que no viene se marca
 * borrado) y KV queda exactamente como debe. Las claves de KV que no conoce kv_published
 * (p. ej. escritas por la Pi antes de esta API) también se borran si sobran.
 */
export async function syncAll(env: Env, body: SyncBody): Promise<SyncResponse> {
  const { revision } = body;
  await env.DB.batch([
    env.DB.prepare('UPDATE business_profile SET deleted = 1, revision = ? WHERE revision < ?').bind(
      revision,
      revision,
    ),
    env.DB.prepare('UPDATE tag_inventory SET deleted = 1, revision = ? WHERE revision < ?').bind(
      revision,
      revision,
    ),
    ...upserts(
      env.DB,
      'business_profile',
      BUSINESS_COLUMNS,
      body.businesses.map((b) => businessValues(b, revision)),
      true,
    ),
    ...upserts(
      env.DB,
      'tag_inventory',
      TAG_COLUMNS,
      body.tags.map((t) => tagValues(t, revision)),
      true,
    ),
  ]);

  const [businessRows, tagRows, publishedRows, kvKeys] = await Promise.all([
    env.DB.prepare('SELECT * FROM business_profile WHERE deleted = 0').all<BusinessRow>(),
    env.DB.prepare('SELECT * FROM tag_inventory WHERE deleted = 0').all<TagRow>(),
    env.DB.prepare('SELECT key, owner, value FROM kv_published').all<{ key: string } & Published>(),
    listAllKvKeys(env.LINKS),
  ]);
  const desired = projectAll(businessRows.results.map(toBusiness), tagRows.results.map(toTag));
  const current = new Map<string, Published>(
    publishedRows.results.map((r) => [r.key, { owner: r.owner, value: r.value }]),
  );
  for (const key of kvKeys) {
    if (!current.has(key)) current.set(key, { owner: '', value: '' });
  }
  const { written, deleted } = await applyKv(env, desired, current);

  const counts = { tags: 0, businesses: 0, reports: 0 };
  for (const key of desired.keys()) {
    if (key.startsWith('business:')) counts.businesses++;
    else if (key.startsWith('report:')) counts.reports++;
    else counts.tags++;
  }
  return { ...counts, written, deleted };
}
