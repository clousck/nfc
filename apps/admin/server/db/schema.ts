import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  createdAt: integer('created_at').notNull(),
});

export const tags = sqliteTable(
  'tags',
  {
    slug: text('slug').primaryKey(), // 6–7 chars base62, aleatorio
    businessId: text('business_id').references(() => businesses.id), // NULL = chip en inventario
    label: text('label'),
    type: text('type', { enum: ['redirect', 'landing'] }).notNull(),
    targetUrl: text('target_url'),
    active: integer('active', { mode: 'boolean' })
      .notNull()
      .default(sql`1`),
    lockedAt: integer('locked_at'),
    syncedAt: integer('synced_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('idx_tags_business_id').on(table.businessId)],
);

export const landings = sqliteTable('landings', {
  businessId: text('business_id')
    .primaryKey()
    .references(() => businesses.id),
  configJson: text('config_json').notNull(), // validado con LandingConfig
  updatedAt: integer('updated_at').notNull(),
  syncedAt: integer('synced_at'),
});

export type Business = typeof businesses.$inferSelect;
export type Tag = typeof tags.$inferSelect;
