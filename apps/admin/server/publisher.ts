import type { BusinessState, SyncResponse, TagState } from '@nfc/shared';
import { and, asc, count, eq, isNotNull, lte, max, min, sql } from 'drizzle-orm';
import type { SyncResult } from './contracts.js';
import type { Db } from './db/client.js';
import { businesses, publishQueue, tags, type Business, type Tag } from './db/schema.js';
import { EdgeError, type EdgeClient } from './edge-client.js';

// Publicación hacia el Worker con cola de reintentos (patrón outbox):
//   1. El servicio guarda el cambio y, en la MISMA transacción, una nota en publish_queue.
//   2. Se intenta enviar enseguida; si funciona, la nota se borra.
//   3. Si falla, la nota queda y se reintenta con espera creciente (30 s, 1 min… 15 min).
// Cada envío lleva el estado ACTUAL de la entidad, así repetirlo nunca causa daño.

export type Entity = `tag:${string}` | `business:${string}`;
export const tagEntity = (slug: string): Entity => `tag:${slug}`;
export const businessEntity = (id: string): Entity => `business:${id}`;

/** Una transacción de Drizzle o la base directamente. */
export type Writer = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface PublishStatus {
  /** Entidades pendientes de publicar. */
  pending: number;
  /** De ellas, cuántas ya fallaron al menos una vez. */
  failing: number;
  lastError: string | null;
  nextAttemptAt: number | null;
}

export interface ResyncResult extends SyncResponse {
  /** Total de claves publicadas en KV. */
  published: number;
}

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

/** Espera antes del reintento número `attempts` (1, 2, 3…): 30 s, 1 min, 2 min… máx. 15 min. */
export function retryDelay(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(attempts - 1, 0), MAX_DELAY_MS);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Sin respuesta del Worker o error del servidor: es inútil seguir con el resto ahora. */
function isOutage(err: unknown): boolean {
  return err instanceof EdgeError && (err.status === 0 || err.status >= 500);
}

export function toTagState(tag: Tag): TagState {
  return {
    slug: tag.slug,
    number: tag.number,
    businessId: tag.businessId,
    assignedAt: tag.assignedAt,
    label: tag.label,
    type: tag.type,
    targetUrl: tag.targetUrl,
    active: tag.active,
  };
}

export function toBusinessState(business: Business): BusinessState {
  return {
    id: business.id,
    name: business.name,
    status: business.status,
    reportToken: business.reportToken,
    loyaltyVisits: business.loyaltyVisits,
  };
}

export type Publisher = ReturnType<typeof createPublisher>;

export function createPublisher({
  db,
  edge,
  now = Date.now,
}: {
  db: Db;
  edge: EdgeClient;
  now?: () => number;
}) {
  // Revisión creciente aunque dos cambios caigan en el mismo milisegundo.
  let lastRevision = 0;
  const nextRevision = () => (lastRevision = Math.max(now(), lastRevision + 1));

  // Los envíos van de uno en uno: llegan al Worker en el mismo orden en que se hicieron.
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  }

  async function send(entity: Entity): Promise<void> {
    const separator = entity.indexOf(':');
    const kind = entity.slice(0, separator);
    const id = entity.slice(separator + 1);
    if (kind === 'tag') {
      const tag = db.select().from(tags).where(eq(tags.slug, id)).get();
      if (tag) {
        await edge.putTag(toTagState(tag), nextRevision());
        db.update(tags).set({ syncedAt: now() }).where(eq(tags.slug, id)).run();
      } else {
        await edge.deleteTag(id, nextRevision());
      }
      return;
    }
    const business = db.select().from(businesses).where(eq(businesses.id, id)).get();
    if (business) {
      // El Worker también recalcula los chips del negocio (su estado los activa o pausa).
      await edge.putBusiness(toBusinessState(business), nextRevision());
      db.update(tags).set({ syncedAt: now() }).where(eq(tags.businessId, id)).run();
    } else {
      await edge.deleteBusiness(id, nextRevision());
    }
  }

  /** Envía una entidad de la cola y actualiza su nota. No lanza. */
  async function deliver(entity: Entity): Promise<SyncResult & { outage?: boolean }> {
    const note = db.select().from(publishQueue).where(eq(publishQueue.entity, entity)).get();
    if (!note) return { ok: true }; // ya se publicó por otro camino
    const sameNote = and(eq(publishQueue.entity, entity), eq(publishQueue.seq, note.seq));
    try {
      await send(entity);
      // Si la entidad cambió durante el envío, su nota tiene otro seq y se queda.
      db.delete(publishQueue).where(sameNote).run();
      return { ok: true };
    } catch (err) {
      const attempts = note.attempts + 1;
      db.update(publishQueue)
        .set({
          attempts,
          nextAttemptAt: now() + retryDelay(attempts),
          lastError: errorMessage(err),
        })
        .where(sameNote)
        .run();
      return { ok: false, error: errorMessage(err), outage: isOutage(err) };
    }
  }

  const publisher = {
    /** Anota entidades pendientes. Llamar dentro de la transacción que hace el cambio. */
    enqueue(writer: Writer, entities: readonly Entity[]): void {
      const at = now();
      for (const entity of new Set(entities)) {
        writer
          .insert(publishQueue)
          .values({ entity, seq: nextRevision(), attempts: 0, nextAttemptAt: at, createdAt: at })
          .onConflictDoUpdate({
            target: publishQueue.entity,
            set: { seq: sql`excluded.seq`, attempts: 0, nextAttemptAt: at, lastError: null },
          })
          .run();
      }
    },

    /** Intenta publicar ya. Si falla, el cambio sigue en la cola y se reintentará solo. */
    publish(entities: readonly Entity[]): Promise<SyncResult> {
      return serial(async () => {
        let result: SyncResult = { ok: true };
        for (const entity of new Set(entities)) {
          const outcome = await deliver(entity);
          if (!outcome.ok && result.ok) result = { ok: false, error: outcome.error };
        }
        return result;
      });
    },

    /** Reintenta lo que ya toca. Si el Worker no responde, para hasta la próxima vuelta. */
    retryDue(limit = 50): Promise<void> {
      return serial(async () => {
        const due = db
          .select({ entity: publishQueue.entity })
          .from(publishQueue)
          .where(lte(publishQueue.nextAttemptAt, now()))
          .orderBy(asc(publishQueue.nextAttemptAt))
          .limit(limit)
          .all();
        for (const { entity } of due) {
          const result = await deliver(entity as Entity);
          if (result.outage) break;
        }
      });
    },

    /**
     * "Re-sincronizar todo": envía la foto completa y el Worker deja KV exactamente igual.
     * Vacía la cola de lo que la foto ya incluye. Lanza si el Worker falla.
     */
    resyncAll(): Promise<ResyncResult> {
      return serial(async () => {
        const revision = nextRevision();
        const snapshot = {
          revision,
          businesses: db.select().from(businesses).all().map(toBusinessState),
          tags: db.select().from(tags).all().map(toTagState),
        };
        const result = await edge.sync(snapshot);
        db.delete(publishQueue).where(lte(publishQueue.seq, revision)).run();
        db.update(tags).set({ syncedAt: now() }).run();
        return { ...result, published: result.tags + result.businesses + result.reports };
      });
    },

    status(): PublishStatus {
      const [summary] = db
        .select({ pending: count(), next: min(publishQueue.nextAttemptAt) })
        .from(publishQueue)
        .all();
      const [failed] = db
        .select({ failing: count(), lastSeq: max(publishQueue.seq) })
        .from(publishQueue)
        .where(isNotNull(publishQueue.lastError))
        .all();
      const last = failed?.lastSeq
        ? db
            .select({ lastError: publishQueue.lastError })
            .from(publishQueue)
            .where(eq(publishQueue.seq, failed.lastSeq))
            .get()
        : undefined;
      return {
        pending: summary?.pending ?? 0,
        failing: failed?.failing ?? 0,
        lastError: last?.lastError ?? null,
        nextAttemptAt: summary?.pending ? (summary.next ?? null) : null,
      };
    },

    /** Reintentos en segundo plano. Devuelve la función para detenerlos. */
    start(intervalMs = 30_000): () => void {
      const tick = () => {
        publisher
          .retryDue()
          .catch((err: unknown) => console.error('[publisher]', errorMessage(err)));
      };
      tick();
      const timer = setInterval(tick, intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
  return publisher;
}
