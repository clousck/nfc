import {
  businessOwner,
  projectAll,
  projectBusiness,
  projectTag,
  tagOwner,
  type ApplyResponse,
  type BusinessState,
  type BusinessSettings,
  type KvValue,
  type PutBusinessSettingsBody,
  type PutTagSettingsBody,
  type SettingsChangesResponse,
  type SyncBody,
  type SyncResponse,
  type TagSettings,
  type TagState,
} from '@nfc/shared';
import { auditStatement, diff, type Actor } from '../audit.js';
import type { Env } from '../env.js';

// Copia del plano de control en D1 y publicación en KV. El Worker es el único que escribe
// en KV: recalcula las claves de cada "dueño" afectado y escribe solo las que cambian.
//
// Límites del plan gratis que condicionan el código: 50 consultas D1 por invocación y 100
// parámetros por consulta (por eso las escrituras van en INSERT de varias filas), y 1.000
// escrituras KV al día (por eso se compara con kv_published antes de escribir).
//
// Ajustes del negocio (destino, etiqueta, pausa, visitas del premio): su dueño es D1
// (tag_settings, business_settings). Lo que la Pi envía en esos campos es solo la semilla
// que se copia al asignar el chip o crear el negocio (ver reconcileSettings).

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
  /** De business_settings (LEFT JOIN); s_id NULL = aún sin sembrar. */
  s_id: string | null;
  s_loyalty_visits: number | null;
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
  /** De tag_settings (LEFT JOIN); s_slug NULL = aún sin sembrar. */
  s_slug: string | null;
  s_target_url: string | null;
  s_label: string | null;
  s_paused_at: number | null;
  s_updated_at: number | null;
}

/** Consultas con los ajustes ya aplicados encima de la copia de la Pi. */
const BUSINESS_SELECT = `SELECT b.*, s.business_id AS s_id, s.loyalty_visits AS s_loyalty_visits
  FROM business_profile b LEFT JOIN business_settings s ON s.business_id = b.id`;
const TAG_SELECT = `SELECT t.*, s.slug AS s_slug, s.target_url AS s_target_url, s.label AS s_label,
    s.paused_at AS s_paused_at, s.updated_at AS s_updated_at
  FROM tag_inventory t LEFT JOIN tag_settings s ON s.slug = t.slug AND s.business_id = t.business_id`;

export type ProjectedTag = TagState & { pausedAt: number | null };

const toBusiness = (r: BusinessRow): BusinessState => ({
  id: r.id,
  name: r.name,
  status: r.status,
  reportToken: r.report_token,
  loyaltyVisits: r.s_id !== null ? r.s_loyalty_visits : r.loyalty_visits,
});

const toTag = (r: TagRow): ProjectedTag => {
  const seeded = r.s_slug !== null;
  return {
    slug: r.slug,
    number: r.number,
    businessId: r.business_id,
    assignedAt: r.assigned_at,
    label: seeded ? r.s_label : r.label,
    type: r.type,
    targetUrl: seeded ? r.s_target_url : r.target_url,
    active: r.active === 1,
    pausedAt: seeded ? r.s_paused_at : null,
  };
};

/**
 * Siembra y descarte de ajustes tras cada cambio de la Pi (dos pasos por tabla):
 *   1. Se borran los ajustes de chips borrados o reasignados (o de negocios borrados): el
 *      destino de un negocio nunca pasa al siguiente.
 *   2. Los chips asignados y negocios sin ajustes los toman de lo que envió la Pi.
 * Los ajustes ya existentes no se tocan: un envío de la Pi nunca pisa un cambio del dueño.
 */
function reconcileSettings(db: D1Database, now: number): D1PreparedStatement[] {
  return [
    db.prepare(
      `DELETE FROM tag_settings WHERE slug IN (
         SELECT s.slug FROM tag_settings s LEFT JOIN tag_inventory t ON t.slug = s.slug
         WHERE t.slug IS NULL OR t.deleted = 1 OR t.business_id IS NOT s.business_id)`,
    ),
    db
      .prepare(
        `INSERT OR IGNORE INTO tag_settings (slug, business_id, target_url, label, paused_at, updated_at)
         SELECT slug, business_id, target_url, label, NULL, ? FROM tag_inventory
         WHERE deleted = 0 AND business_id IS NOT NULL`,
      )
      .bind(now),
    db.prepare(
      `DELETE FROM business_settings WHERE business_id IN (
         SELECT s.business_id FROM business_settings s
         LEFT JOIN business_profile b ON b.id = s.business_id
         WHERE b.id IS NULL OR b.deleted = 1)`,
    ),
    db
      .prepare(
        `INSERT OR IGNORE INTO business_settings (business_id, loyalty_visits, updated_at)
         SELECT id, loyalty_visits, ? FROM business_profile WHERE deleted = 0`,
      )
      .bind(now),
  ];
}

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
          `${BUSINESS_SELECT} WHERE b.deleted = 0 AND b.id IN (${placeholders(ids.length)})`,
        )
          .bind(...ids)
          .all<BusinessRow>()
      : Promise.resolve({ results: [] as BusinessRow[] }),
    ids.length + slugs.length > 0
      ? env.DB.prepare(
          `${TAG_SELECT} WHERE t.deleted = 0 AND (${[
            ids.length > 0 ? `t.business_id IN (${placeholders(ids.length)})` : null,
            slugs.length > 0 ? `t.slug IN (${placeholders(slugs.length)})` : null,
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
  return db.prepare(`${TAG_SELECT} WHERE t.slug = ?`).bind(slug).first<TagRow>();
}

async function businessRow(db: D1Database, id: string): Promise<BusinessRow | null> {
  return db.prepare(`${BUSINESS_SELECT} WHERE b.id = ?`).bind(id).first<BusinessRow>();
}

const NOT_APPLIED: ApplyResponse = { applied: false, written: 0, deleted: 0 };

export async function putTag(env: Env, tag: TagState, revision: number): Promise<ApplyResponse> {
  const old = await tagRow(env.DB, tag.slug);
  if (old && old.revision >= revision) return NOT_APPLIED;
  await env.DB.batch([
    ...upserts(env.DB, 'tag_inventory', TAG_COLUMNS, [tagValues(tag, revision)], false),
    ...reconcileSettings(env.DB, Date.now()),
  ]);
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
  await env.DB.batch([
    tombstone(env.DB, 'tag_inventory', slug, revision),
    ...reconcileSettings(env.DB, Date.now()),
  ]);
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
  await env.DB.batch([
    ...upserts(
      env.DB,
      'business_profile',
      BUSINESS_COLUMNS,
      [businessValues(business, revision)],
      false,
    ),
    ...reconcileSettings(env.DB, Date.now()),
  ]);
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
  await env.DB.batch([
    tombstone(env.DB, 'business_profile', id, revision),
    ...reconcileSettings(env.DB, Date.now()),
  ]);
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
    ...reconcileSettings(env.DB, Date.now()),
  ]);

  const [businessRows, tagRows, publishedRows, kvKeys] = await Promise.all([
    env.DB.prepare(`${BUSINESS_SELECT} WHERE b.deleted = 0`).all<BusinessRow>(),
    env.DB.prepare(`${TAG_SELECT} WHERE t.deleted = 0`).all<TagRow>(),
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

// --- Ajustes del negocio ---

export type SettingsError = 'not_found' | 'not_assigned';
export type SettingsResult<T> =
  { ok: true; settings: T; publish: ApplyResponse } | { ok: false; error: SettingsError };

const UNCHANGED: ApplyResponse = { applied: false, written: 0, deleted: 0 };

/** Destino, etiqueta o pausa de un chip asignado; queda en la auditoría y se publica. */
export async function putTagSettings(
  env: Env,
  slug: string,
  patch: PutTagSettingsBody,
  actor: Actor,
  now = Date.now(),
  /** El dueño solo puede tocar chips de su negocio: si no coincide, responde como inexistente. */
  expectedBusinessId: string | null = null,
): Promise<SettingsResult<TagSettings>> {
  const row = await tagRow(env.DB, slug);
  if (!row || row.deleted) return { ok: false, error: 'not_found' };
  if (expectedBusinessId !== null && row.business_id !== expectedBusinessId) {
    return { ok: false, error: 'not_found' };
  }
  const businessId = row.business_id;
  if (!businessId) return { ok: false, error: 'not_assigned' };
  const current = toTag(row);
  const before = { targetUrl: current.targetUrl, label: current.label, pausedAt: current.pausedAt };
  const after = {
    targetUrl: patch.targetUrl !== undefined ? patch.targetUrl : before.targetUrl,
    label: patch.label !== undefined ? patch.label || null : before.label,
    // Pausar dos veces conserva la fecha de la primera.
    pausedAt:
      patch.paused === undefined ? before.pausedAt : patch.paused ? (before.pausedAt ?? now) : null,
  };
  const changes = diff(before, after);
  const settings = (updatedAt: number): TagSettings => ({ slug, businessId, ...after, updatedAt });
  if (!changes)
    return { ok: true, settings: settings(row.s_updated_at ?? now), publish: UNCHANGED };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tag_settings (slug, business_id, target_url, label, paused_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET business_id = excluded.business_id,
         target_url = excluded.target_url, label = excluded.label,
         paused_at = excluded.paused_at, updated_at = excluded.updated_at`,
    ).bind(slug, businessId, after.targetUrl, after.label, after.pausedAt, now),
    auditStatement(env.DB, {
      businessId,
      actor,
      action: 'tag.settings',
      target: slug,
      ...changes,
      ts: now,
    }),
  ]);
  // El negocio también: la etiqueta aparece en su enlace de estadísticas.
  const publish = await publishOwners(env, [businessId], [slug]);
  return { ok: true, settings: settings(now), publish: { applied: true, ...publish } };
}

/** Visitas del premio (null desactiva el programa); queda en la auditoría y se publica. */
export async function putBusinessSettings(
  env: Env,
  id: string,
  patch: PutBusinessSettingsBody,
  actor: Actor,
  now = Date.now(),
): Promise<SettingsResult<BusinessSettings>> {
  const row = await businessRow(env.DB, id);
  if (!row || row.deleted) return { ok: false, error: 'not_found' };
  const before = { loyaltyVisits: toBusiness(row).loyaltyVisits };
  const after = { loyaltyVisits: patch.loyaltyVisits };
  const changes = diff(before, after);
  const settings: BusinessSettings = { businessId: id, ...after, updatedAt: now };
  if (!changes) return { ok: true, settings, publish: UNCHANGED };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO business_settings (business_id, loyalty_visits, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(business_id) DO UPDATE SET loyalty_visits = excluded.loyalty_visits,
         updated_at = excluded.updated_at`,
    ).bind(id, after.loyaltyVisits, now),
    auditStatement(env.DB, {
      businessId: id,
      actor,
      action: 'business.settings',
      target: id,
      ...changes,
      ts: now,
    }),
  ]);
  const publish = await publishOwners(env, [id], []);
  return { ok: true, settings, publish: { applied: true, ...publish } };
}

/** Ajustes cambiados desde `since` (incluido): la Pi los usa para refrescar su copia. */
export async function settingsChanges(
  db: D1Database,
  since: number,
): Promise<SettingsChangesResponse> {
  const [tags, businesses] = await Promise.all([
    db
      .prepare(
        `SELECT slug, business_id, target_url, label, paused_at, updated_at FROM tag_settings
         WHERE updated_at >= ? ORDER BY updated_at`,
      )
      .bind(since)
      .all<{
        slug: string;
        business_id: string;
        target_url: string | null;
        label: string | null;
        paused_at: number | null;
        updated_at: number;
      }>(),
    db
      .prepare(
        `SELECT business_id, loyalty_visits, updated_at FROM business_settings
         WHERE updated_at >= ? ORDER BY updated_at`,
      )
      .bind(since)
      .all<{ business_id: string; loyalty_visits: number | null; updated_at: number }>(),
  ]);
  return {
    tags: tags.results.map((r) => ({
      slug: r.slug,
      businessId: r.business_id,
      targetUrl: r.target_url,
      label: r.label,
      pausedAt: r.paused_at,
      updatedAt: r.updated_at,
    })),
    businesses: businesses.results.map((r) => ({
      businessId: r.business_id,
      loyaltyVisits: r.loyalty_visits,
      updatedAt: r.updated_at,
    })),
  };
}

/** Chips de un negocio con sus ajustes ya aplicados (portal). */
export async function businessTags(db: D1Database, businessId: string): Promise<ProjectedTag[]> {
  const { results } = await db
    .prepare(`${TAG_SELECT} WHERE t.deleted = 0 AND t.business_id = ? ORDER BY t.number`)
    .bind(businessId)
    .all<TagRow>();
  return results.map(toTag);
}

/** Negocio con sus ajustes ya aplicados (portal); null si no existe o está borrado. */
export async function businessState(db: D1Database, id: string): Promise<BusinessState | null> {
  const row = await businessRow(db, id);
  return row && !row.deleted ? toBusiness(row) : null;
}
