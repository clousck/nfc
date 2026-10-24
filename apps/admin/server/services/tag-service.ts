import { generateSlug, projectTag, type PutTagSettingsBody } from '@nfc/shared';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { SyncResult } from '../contracts.js';
import type { Db } from '../db/client.js';
import { businesses, tagCounter, tags, type Business, type Tag } from '../db/schema.js';
import { EdgeError, type EdgeClient } from '../edge-client.js';
import { tagEntity, type Publisher } from '../publisher.js';
import { applyTagSettings } from '../settings-sync.js';
import type { TagCreate, TagUpdate } from '../validation.js';

export type TagCreateInput = z.output<typeof TagCreate>;
export type TagUpdateInput = z.output<typeof TagUpdate>;

export interface TagWithStatus {
  tag: Tag;
  /** Si con su estado actual el chip debe existir en KV. */
  published: boolean;
}

export type CreateTagResult =
  | ({ ok: true; sync: SyncResult } & TagWithStatus)
  | { ok: false; error: 'business_not_found' | 'slug_generation_failed' };

export type UpdateTagResult =
  | ({ ok: true; sync: SyncResult } & TagWithStatus)
  | { ok: false; error: 'not_found' | 'business_not_found' }
  | { ok: false; error: 'edge_unavailable'; detail: string };

export type LockTagResult =
  | ({ ok: true } & TagWithStatus)
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'already_locked'; lockedAt: number };

export type DeleteTagResult =
  { ok: true; sync: SyncResult } | { ok: false; error: 'not_found' | 'locked' };

export type QrTargetResult =
  { ok: true; tag: Tag } | { ok: false; error: 'not_found' | 'loyalty_no_qr' };

export type TagService = ReturnType<typeof createTagService>;

const MAX_SLUG_ATTEMPTS = 5;

const definedOnly = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}

/**
 * Ajustes que el negocio también puede cambiar (dueño: D1). Se separan del resto del cambio
 * para enviarlos al Worker antes de tocar nada aquí.
 */
function splitSettings(patch: TagUpdateInput) {
  const { label, targetUrl, paused, ...inventory } = patch;
  const settings: PutTagSettingsBody = {};
  if (label !== undefined) settings.label = label;
  if (targetUrl !== undefined) settings.targetUrl = targetUrl;
  if (paused !== undefined) settings.paused = paused;
  return { settings, inventory, seed: { label, targetUrl } };
}

/** Inventario de chips: alta, asignación, bloqueo físico y borrado. */
export function createTagService({
  db,
  publisher,
  edge,
}: {
  db: Db;
  publisher: Publisher;
  edge: EdgeClient;
}) {
  const findTag = (slug: string) => db.select().from(tags).where(eq(tags.slug, slug)).get();

  const findBusiness = (id: string) =>
    db.select().from(businesses).where(eq(businesses.id, id)).get();

  const withStatus = (tag: Tag, business?: Business | null): TagWithStatus => {
    const owner =
      business !== undefined
        ? business
        : tag.businessId
          ? (findBusiness(tag.businessId) ?? null)
          : null;
    return { tag, published: projectTag(tag, owner) !== null };
  };

  return {
    withStatus,

    list(filter: { businessId?: string; unassigned?: boolean } = {}): TagWithStatus[] {
      const filters: SQL[] = [];
      if (filter.businessId) filters.push(eq(tags.businessId, filter.businessId));
      if (filter.unassigned) filters.push(isNull(tags.businessId));
      return db
        .select({ tag: tags, business: businesses })
        .from(tags)
        .leftJoin(businesses, eq(tags.businessId, businesses.id))
        .where(and(...filters))
        .orderBy(desc(tags.number))
        .all()
        .map(({ tag, business }) => withStatus(tag, business));
    },

    get(slug: string): TagWithStatus | null {
      const tag = findTag(slug);
      return tag ? withStatus(tag) : null;
    },

    getByNumber(number: number): TagWithStatus | null {
      const tag = db.select().from(tags).where(eq(tags.number, number)).get();
      return tag ? withStatus(tag) : null;
    },

    async create(input: TagCreateInput): Promise<CreateTagResult> {
      if (input.businessId && !findBusiness(input.businessId)) {
        return { ok: false, error: 'business_not_found' };
      }
      let created: Tag | undefined;
      for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS && !created; attempt++) {
        try {
          // Número y chip en la misma transacción: si el slug choca, el contador no avanza.
          created = db.transaction((tx) => {
            const counter = tx
              .insert(tagCounter)
              .values({ id: 1, last: 1 })
              .onConflictDoUpdate({
                target: tagCounter.id,
                set: { last: sql`${tagCounter.last} + 1` },
              })
              .returning()
              .get();
            const tag = tx
              .insert(tags)
              .values({
                ...input,
                slug: generateSlug(),
                number: counter.last,
                assignedAt: input.businessId ? Date.now() : null,
                createdAt: Date.now(),
              })
              .returning()
              .get();
            publisher.enqueue(tx, [tagEntity(tag.slug)]);
            return tag;
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      if (!created) return { ok: false, error: 'slug_generation_failed' };

      const sync = await publisher.publish([tagEntity(created.slug)]);
      return { ok: true, sync, ...withStatus(findTag(created.slug) ?? created) };
    },

    async update(slug: string, patch: TagUpdateInput): Promise<UpdateTagResult> {
      const current = findTag(slug);
      if (!current) return { ok: false, error: 'not_found' };
      if (patch.businessId && !findBusiness(patch.businessId)) {
        return { ok: false, error: 'business_not_found' };
      }
      // Regla: al cambiar de negocio, las estadísticas empiezan de cero para el nuevo.
      const reassigned = patch.businessId !== undefined && patch.businessId !== current.businessId;
      const { settings, inventory, seed } = splitSettings(patch);
      let changes: Partial<Tag> = reassigned
        ? { ...inventory, assignedAt: inventory.businessId ? Date.now() : null }
        : inventory;

      if (reassigned || !current.businessId) {
        // Sin negocio (o cambiando de negocio) los ajustes viajan como semilla con el chip:
        // el Worker descarta los del negocio anterior y siembra estos.
        changes = { ...changes, ...definedOnly(seed), ...(reassigned ? { pausedAt: null } : {}) };
      } else if (Object.keys(settings).length > 0) {
        // Chip asignado: el dueño de los ajustes es D1. Si el Worker no responde, no se guarda
        // nada (en la cola podría pisar un cambio que el negocio haga mientras tanto).
        try {
          applyTagSettings(db, await edge.putTagSettings(slug, settings));
        } catch (err) {
          // 404/409 = el Worker aún no tiene el chip o no sabe que es de este negocio (alta o
          // asignación en la cola): los ajustes van como semilla con el chip.
          if (err instanceof EdgeError && (err.status === 404 || err.status === 409)) {
            changes = { ...changes, ...definedOnly(seed) };
          } else {
            const detail = err instanceof Error ? err.message : String(err);
            return { ok: false, error: 'edge_unavailable', detail };
          }
        }
      }
      db.transaction((tx) => {
        if (Object.keys(changes).length > 0) {
          tx.update(tags).set(changes).where(eq(tags.slug, slug)).run();
        }
        // El Worker recalcula también el enlace de estadísticas del negocio anterior.
        publisher.enqueue(tx, [tagEntity(slug)]);
      });
      const sync = await publisher.publish([tagEntity(slug)]);
      const tag = findTag(slug);
      if (!tag) return { ok: false, error: 'not_found' };
      return { ok: true, sync, ...withStatus(tag) };
    },

    /** Marca el chip físico como bloqueado (tras escribirlo y hacer makeReadOnly). */
    lock(slug: string): LockTagResult {
      const tag = findTag(slug);
      if (!tag) return { ok: false, error: 'not_found' };
      // Regla: el bloqueo físico es irreversible; se registra una sola vez.
      if (tag.lockedAt) return { ok: false, error: 'already_locked', lockedAt: tag.lockedAt };
      const updated = db
        .update(tags)
        .set({ lockedAt: Date.now() })
        .where(eq(tags.slug, slug))
        .returning()
        .get();
      return { ok: true, ...withStatus(updated ?? tag) };
    },

    async delete(slug: string): Promise<DeleteTagResult> {
      const tag = findTag(slug);
      if (!tag) return { ok: false, error: 'not_found' };
      // Regla: un chip bloqueado tiene su URL grabada para siempre; se desactiva o reasigna.
      if (tag.lockedAt) return { ok: false, error: 'locked' };
      db.transaction((tx) => {
        tx.delete(tags).where(eq(tags.slug, slug)).run();
        // El Worker lo retira de KV y del enlace de estadísticas de su negocio.
        publisher.enqueue(tx, [tagEntity(slug)]);
      });
      return { ok: true, sync: await publisher.publish([tagEntity(slug)]) };
    },

    /** Chip para el que se puede generar el QR impreso. */
    qrTarget(slug: string): QrTargetResult {
      const tag = findTag(slug);
      if (!tag) return { ok: false, error: 'not_found' };
      // Regla: con la URL del QR se podrían sumar sellos sin ir al local.
      if (tag.type === 'loyalty') return { ok: false, error: 'loyalty_no_qr' };
      return { ok: true, tag };
    },
  };
}
