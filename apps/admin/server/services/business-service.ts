import { generateId, generateReportToken, projectTag } from '@nfc/shared';
import { asc, count, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { SyncResult } from '../contracts.js';
import type { Db } from '../db/client.js';
import { businesses, tags, type Business } from '../db/schema.js';
import { businessEntity, type Publisher, type Writer } from '../publisher.js';
import type { BusinessCreate, BusinessUpdate } from '../validation.js';
import type { TagWithStatus } from './tag-service.js';

export type BusinessCreateInput = z.output<typeof BusinessCreate>;
export type BusinessUpdateInput = z.output<typeof BusinessUpdate>;

export type BusinessResult =
  { ok: true; business: Business; sync: SyncResult } | { ok: false; error: 'not_found' };

export type DeleteBusinessResult =
  { ok: true; sync: SyncResult } | { ok: false; error: 'not_found' | 'has_tags' };

export type BusinessService = ReturnType<typeof createBusinessService>;

/** Negocios: datos comerciales, enlace de estadísticas y su publicación. */
export function createBusinessService({ db, publisher }: { db: Db; publisher: Publisher }) {
  const find = (id: string): Business | null =>
    db.select().from(businesses).where(eq(businesses.id, id)).get() ?? null;

  /** Guarda el cambio y su nota de publicación juntos; luego intenta publicar. */
  async function saveAndPublish(
    id: string,
    change: (tx: Writer) => Business | undefined,
  ): Promise<BusinessResult> {
    const business = db.transaction((tx) => {
      const row = change(tx);
      if (row) publisher.enqueue(tx, [businessEntity(id)]);
      return row;
    });
    if (!business) return { ok: false, error: 'not_found' };
    return { ok: true, business, sync: await publisher.publish([businessEntity(id)]) };
  }

  return {
    find,

    list(): Business[] {
      return db.select().from(businesses).orderBy(desc(businesses.createdAt)).all();
    },

    get(id: string): { business: Business; tags: TagWithStatus[] } | null {
      const business = find(id);
      if (!business) return null;
      const rows = db
        .select()
        .from(tags)
        .where(eq(tags.businessId, id))
        .orderBy(asc(tags.number))
        .all();
      return {
        business,
        tags: rows.map((tag) => ({ tag, published: projectTag(tag, business) !== null })),
      };
    },

    async create(input: BusinessCreateInput): Promise<{ business: Business; sync: SyncResult }> {
      const id = generateId('b');
      // Con token desde el principio: el enlace de estadísticas funciona desde el primer día.
      const result = await saveAndPublish(id, (tx) =>
        tx
          .insert(businesses)
          .values({ ...input, id, reportToken: generateReportToken(), createdAt: Date.now() })
          .returning()
          .get(),
      );
      if (!result.ok) throw new Error('No se pudo crear el negocio');
      return { business: result.business, sync: result.sync };
    },

    update(id: string, patch: BusinessUpdateInput): Promise<BusinessResult> {
      // El estado y el nombre afectan a sus chips y a su enlace: el Worker los recalcula.
      return saveAndPublish(id, (tx) =>
        Object.keys(patch).length > 0
          ? tx.update(businesses).set(patch).where(eq(businesses.id, id)).returning().get()
          : tx.select().from(businesses).where(eq(businesses.id, id)).get(),
      );
    },

    /** Crea o regenera el enlace privado de estadísticas; el anterior deja de funcionar. */
    regenerateReportToken(id: string): Promise<BusinessResult> {
      return saveAndPublish(id, (tx) =>
        tx
          .update(businesses)
          .set({ reportToken: generateReportToken() })
          .where(eq(businesses.id, id))
          .returning()
          .get(),
      );
    },

    async delete(id: string): Promise<DeleteBusinessResult> {
      const [assigned] = db.select({ n: count() }).from(tags).where(eq(tags.businessId, id)).all();
      // Regla: un negocio con chips no se borra; se liberan sus chips o se marca cancelado.
      if (assigned && assigned.n > 0) return { ok: false, error: 'has_tags' };
      const deleted = db.transaction((tx) => {
        const row = tx.delete(businesses).where(eq(businesses.id, id)).returning().get();
        if (row) publisher.enqueue(tx, [businessEntity(id)]);
        return row;
      });
      if (!deleted) return { ok: false, error: 'not_found' };
      return { ok: true, sync: await publisher.publish([businessEntity(id)]) };
    },
  };
}
