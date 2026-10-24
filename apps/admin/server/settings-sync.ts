import type { BusinessSettings, TagSettings } from '@nfc/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { businesses, tags } from './db/schema.js';
import type { EdgeClient } from './edge-client.js';
import type { Writer } from './publisher.js';

// Copia local de los ajustes del negocio (destino, etiqueta, pausa, visitas del premio).
// Su dueño es D1: el dueño del negocio los cambia en el portal y el admin, mediante la API
// interna. La Pi solo refresca su copia para mostrarla en el panel (consistencia eventual:
// ≤ 30 s de retraso).

export function applyTagSettings(db: Writer, settings: TagSettings): void {
  // Solo si el chip sigue en el mismo negocio: si la Pi ya lo reasignó, la fila es vieja.
  db.update(tags)
    .set({ label: settings.label, targetUrl: settings.targetUrl, pausedAt: settings.pausedAt })
    .where(and(eq(tags.slug, settings.slug), eq(tags.businessId, settings.businessId)))
    .run();
}

export function applyBusinessSettings(db: Writer, settings: BusinessSettings): void {
  db.update(businesses)
    .set({ loyaltyVisits: settings.loyaltyVisits })
    .where(eq(businesses.id, settings.businessId))
    .run();
}

export type SettingsSync = ReturnType<typeof createSettingsSync>;

export function createSettingsSync({ db, edge }: { db: Db; edge: EdgeClient }) {
  // En memoria: tras reiniciar, la primera consulta trae todo (son pocas filas).
  let cursor = 0;

  const sync = {
    /** Trae los ajustes cambiados desde la última vez. Lanza si el Worker falla. */
    async pull(): Promise<number> {
      const changes = await edge.settingsChanges(cursor);
      db.transaction((tx) => {
        for (const row of changes.tags) applyTagSettings(tx, row);
        for (const row of changes.businesses) applyBusinessSettings(tx, row);
      });
      // `since` es inclusivo: lo del último milisegundo se repite, nunca se pierde.
      for (const row of [...changes.tags, ...changes.businesses]) {
        cursor = Math.max(cursor, row.updatedAt);
      }
      return changes.tags.length + changes.businesses.length;
    },

    /** Refresco en segundo plano. Devuelve la función para detenerlo. */
    start(intervalMs = 30_000): () => void {
      const tick = () => {
        sync.pull().catch((err: unknown) => {
          console.error('[settings]', err instanceof Error ? err.message : String(err));
        });
      };
      tick();
      const timer = setInterval(tick, intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
  return sync;
}
