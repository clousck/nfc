import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Timestamps en epoch ms (igual que `scans.ts` en D1).

export const businesses = sqliteTable('businesses', {
  id: text('id').primaryKey(), // b_<base62>
  name: text('name').notNull(),
  contactName: text('contact_name'),
  phone: text('phone'),
  plan: text('plan', { enum: ['basic', 'premium'] })
    .notNull()
    .default('basic'),
  status: text('status', { enum: ['active', 'paused', 'cancelled'] })
    .notNull()
    .default('active'),
  notes: text('notes'),
  // Token del enlace privado de estadísticas (go.penginexr.com/r/<token>). NULL = sin enlace.
  reportToken: text('report_token').unique(),
  // Programa de fidelidad: visitas necesarias para el premio. NULL = programa desactivado.
  // Su dueño es D1 (business_settings); aquí es una copia que se refresca sola.
  loyaltyVisits: integer('loyalty_visits'),
  createdAt: integer('created_at').notNull(),
});

export const tags = sqliteTable(
  'tags',
  {
    slug: text('slug').primaryKey(), // 6–7 chars base62, aleatorio
    // Número correlativo para identificar el chip a simple vista (#1, #2…). Nunca se reutiliza.
    number: integer('number').notNull(),
    businessId: text('business_id').references(() => businesses.id), // NULL = chip en inventario
    // Cuándo se asignó al negocio actual: las estadísticas cuentan desde aquí. NULL = desde siempre.
    assignedAt: integer('assigned_at'),
    // label y targetUrl: su dueño es D1 (ajustes del negocio). Aquí son una copia que se
    // refresca sola, y la semilla que se envía al asignar el chip.
    label: text('label'),
    type: text('type', { enum: ['redirect', 'landing', 'loyalty'] }).notNull(),
    targetUrl: text('target_url'),
    active: integer('active', { mode: 'boolean' })
      .notNull()
      .default(sql`1`),
    lockedAt: integer('locked_at'),
    // Copia de D1: el dueño lo pausó ("stand perdido"). Ver settings-sync.ts.
    pausedAt: integer('paused_at'),
    syncedAt: integer('synced_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_tags_business_id').on(table.businessId),
    uniqueIndex('idx_tags_number').on(table.number),
  ],
);

/** Contador de una sola fila con el último número de chip asignado. */
export const tagCounter = sqliteTable(
  'tag_counter',
  {
    id: integer('id').primaryKey(),
    last: integer('last').notNull(),
  },
  (table) => [check('tag_counter_single_row', sql`${table.id} = 1`)],
);

export const landings = sqliteTable('landings', {
  businessId: text('business_id')
    .primaryKey()
    .references(() => businesses.id),
  configJson: text('config_json').notNull(), // validado con LandingConfig
  updatedAt: integer('updated_at').notNull(),
  syncedAt: integer('synced_at'),
});

/**
 * Cola de publicación (patrón outbox): entidades cuyo estado falta enviar al Worker. Se
 * escribe en la misma transacción que el cambio, así ningún cambio se pierde aunque falle
 * internet o se reinicie la Pi.
 */
export const publishQueue = sqliteTable('publish_queue', {
  entity: text('entity').primaryKey(), // 'tag:<slug>' | 'business:<id>'
  // Sube con cada cambio: si la entidad cambió durante un envío, la nota no se borra.
  seq: integer('seq').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
});

export type Business = typeof businesses.$inferSelect;
export type Tag = typeof tags.$inferSelect;
