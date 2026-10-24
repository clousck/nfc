import { fileURLToPath } from 'node:url';
import {
  projectAll,
  type ApplyResponse,
  type BusinessSettings,
  type BusinessState,
  type KvValue,
  type LinkRecord,
  type LoyaltyCardsResponse,
  type LoyaltyContactsResponse,
  type PutBusinessSettingsBody,
  type PutTagSettingsBody,
  type RateLimitIncidentsResponse,
  type SyncBody,
  type TagScanStatsResponse,
  type TagSettings,
  type TagState,
} from '@nfc/shared';
import type { MiddlewareHandler } from 'hono';
import { createApp } from '../server/app.js';
import type { AppEnv } from '../server/context.js';
import { openDb } from '../server/db/client.js';
import { EdgeError, type EdgeClient } from '../server/edge-client.js';
import { createPublisher } from '../server/publisher.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

type Card = LoyaltyCardsResponse['cards'][number];

/**
 * Worker simulado en memoria. Guarda la copia del plano de control con las mismas reglas de
 * revisión y calcula KV con la proyección real (`projectAll`), así los tests comprueban lo
 * que de verdad acabaría en KV. `failing = true` simula que el Worker no responde.
 * Los ajustes del negocio siguen la misma regla que D1: se siembran con lo que envía la Pi
 * al asignar el chip y después solo cambian con putTagSettings / putBusinessSettings.
 */
export class FakeEdge implements EdgeClient {
  businesses = new Map<string, BusinessState>();
  tags = new Map<string, TagState>();
  private readonly revisions = new Map<string, number>();
  failing = false;
  /** Llamadas recibidas, p. ej. 'PUT tag:abc1234'. */
  readonly calls: string[] = [];
  scanStats = new Map<string, TagScanStatsResponse>();
  cards = new Map<string, Card[]>();
  contacts = new Map<string, LoyaltyContactsResponse['contacts']>();
  incidentList: RateLimitIncidentsResponse['incidents'] = [];
  tagSettings = new Map<string, TagSettings>();
  businessSettings = new Map<string, BusinessSettings>();
  private clock = 1;

  /** Contenido de KV que produciría el Worker. */
  get data(): Map<string, KvValue> {
    const businesses = [...this.businesses.values()].map((b) => ({
      ...b,
      loyaltyVisits: this.businessSettings.get(b.id)?.loyaltyVisits ?? b.loyaltyVisits,
    }));
    const tags = [...this.tags.values()].map((t) => {
      const s = this.tagSettings.get(t.slug);
      return s ? { ...t, label: s.label, targetUrl: s.targetUrl, pausedAt: s.pausedAt } : t;
    });
    const all = projectAll(businesses, tags);
    return new Map([...all].map(([key, { value }]) => [key, value]));
  }

  /** Igual que reconcileSettings en el Worker. */
  private reconcile(): void {
    for (const [slug, s] of this.tagSettings) {
      if (this.tags.get(slug)?.businessId !== s.businessId) this.tagSettings.delete(slug);
    }
    for (const t of this.tags.values()) {
      if (t.businessId && !this.tagSettings.has(t.slug)) {
        this.tagSettings.set(t.slug, {
          slug: t.slug,
          businessId: t.businessId,
          targetUrl: t.targetUrl,
          label: t.label,
          pausedAt: null,
          updatedAt: this.clock++,
        });
      }
    }
    for (const id of this.businessSettings.keys()) {
      if (!this.businesses.has(id)) this.businessSettings.delete(id);
    }
    for (const b of this.businesses.values()) {
      if (!this.businessSettings.has(b.id)) {
        this.businessSettings.set(b.id, {
          businessId: b.id,
          loyaltyVisits: b.loyaltyVisits,
          updatedAt: this.clock++,
        });
      }
    }
  }

  /** Simula un cambio hecho por el dueño en el portal. */
  ownerChangesTag(slug: string, patch: Partial<Omit<TagSettings, 'slug' | 'businessId'>>): void {
    const current = this.tagSettings.get(slug);
    if (!current) throw new Error(`sin ajustes para ${slug}`);
    this.tagSettings.set(slug, { ...current, ...patch, updatedAt: this.clock++ });
  }

  link(slug: string): LinkRecord | undefined {
    return this.data.get(slug) as LinkRecord | undefined;
  }

  /** Claves de chips (sin negocios ni enlaces de estadísticas). */
  linkKeys(): string[] {
    return [...this.data.keys()].filter((key) => !key.includes(':'));
  }

  /** Simula un Worker vacío (p. ej. recién desplegado). */
  reset(): void {
    this.businesses.clear();
    this.tags.clear();
    this.revisions.clear();
    this.tagSettings.clear();
    this.businessSettings.clear();
  }

  private check(call: string): void {
    this.calls.push(call);
    if (this.failing) throw new EdgeError('No se pudo contactar con el Worker (simulado)', 0);
  }

  private apply(key: string, revision: number, change: () => void): ApplyResponse {
    if ((this.revisions.get(key) ?? -1) >= revision) {
      return { applied: false, written: 0, deleted: 0 };
    }
    this.revisions.set(key, revision);
    change();
    this.reconcile();
    return { applied: true, written: 1, deleted: 0 };
  }

  async putBusiness(business: BusinessState, revision: number) {
    this.check(`PUT business:${business.id}`);
    return this.apply(`business:${business.id}`, revision, () =>
      this.businesses.set(business.id, business),
    );
  }

  async deleteBusiness(id: string, revision: number) {
    this.check(`DELETE business:${id}`);
    return this.apply(`business:${id}`, revision, () => this.businesses.delete(id));
  }

  async putTag(tag: TagState, revision: number) {
    this.check(`PUT tag:${tag.slug}`);
    return this.apply(`tag:${tag.slug}`, revision, () => this.tags.set(tag.slug, tag));
  }

  async deleteTag(slug: string, revision: number) {
    this.check(`DELETE tag:${slug}`);
    return this.apply(`tag:${slug}`, revision, () => this.tags.delete(slug));
  }

  async sync(body: SyncBody) {
    this.check('POST sync');
    this.businesses = new Map(body.businesses.map((b) => [b.id, b]));
    this.tags = new Map(body.tags.map((t) => [t.slug, t]));
    this.reconcile();
    const keys = [...this.data.keys()];
    return {
      tags: keys.filter((k) => !k.includes(':')).length,
      businesses: keys.filter((k) => k.startsWith('business:')).length,
      reports: keys.filter((k) => k.startsWith('report:')).length,
      written: keys.length,
      deleted: 0,
    };
  }

  async putTagSettings(slug: string, patch: PutTagSettingsBody): Promise<TagSettings> {
    this.check(`PUT settings:${slug}`);
    const tag = this.tags.get(slug);
    if (!tag) throw new EdgeError('Worker PUT settings → 404', 404);
    const current = this.tagSettings.get(slug);
    if (!tag.businessId || !current) throw new EdgeError('Worker PUT settings → 409', 409);
    const next: TagSettings = {
      ...current,
      ...(patch.targetUrl !== undefined ? { targetUrl: patch.targetUrl } : {}),
      ...(patch.label !== undefined ? { label: patch.label || null } : {}),
      ...(patch.paused !== undefined
        ? { pausedAt: patch.paused ? (current.pausedAt ?? Date.now()) : null }
        : {}),
      updatedAt: this.clock++,
    };
    this.tagSettings.set(slug, next);
    return next;
  }

  async putBusinessSettings(id: string, patch: PutBusinessSettingsBody): Promise<BusinessSettings> {
    this.check(`PUT business-settings:${id}`);
    if (!this.businesses.has(id)) throw new EdgeError('Worker PUT settings → 404', 404);
    const next = { businessId: id, loyaltyVisits: patch.loyaltyVisits, updatedAt: this.clock++ };
    this.businessSettings.set(id, next);
    return next;
  }

  async settingsChanges(since: number) {
    this.check(`GET settings:${since}`);
    return {
      tags: [...this.tagSettings.values()].filter((s) => s.updatedAt >= since),
      businesses: [...this.businessSettings.values()].filter((s) => s.updatedAt >= since),
    };
  }

  async tagScans(slug: string, since: number | null) {
    this.check(`GET scans:${slug}`);
    return (
      this.scanStats.get(slug) ?? {
        since,
        total: 0,
        nfc: 0,
        qr: 0,
        ios: 0,
        android: 0,
        other: 0,
        bots: 0,
        lastAt: null,
        recent: [],
      }
    );
  }

  async loyaltyCards(businessId: string) {
    this.check(`GET cards:${businessId}`);
    return { cards: this.cards.get(businessId) ?? [] };
  }

  async loyaltyContacts(businessId: string) {
    this.check(`GET contacts:${businessId}`);
    return { contacts: this.contacts.get(businessId) ?? [] };
  }

  async incidents(businessId: string | null) {
    this.check(`GET incidents:${businessId ?? '*'}`);
    return {
      mode: 'observe' as const,
      incidents: this.incidentList.filter(
        (i) => businessId === null || i.businessId === businessId,
      ),
    };
  }

  async deleteLoyaltyCard(businessId: string, cardId: number) {
    this.check(`DELETE card:${businessId}:${cardId}`);
    const list = this.cards.get(businessId) ?? [];
    this.cards.set(
      businessId,
      list.filter((c) => c.id !== cardId),
    );
    return list.some((c) => c.id === cardId);
  }
}

export function setup(auth: MiddlewareHandler<AppEnv> | null = null) {
  const { db, close } = openDb(':memory:', migrationsFolder);
  const edge = new FakeEdge();
  const publisher = createPublisher({ db, edge });
  const app = createApp({
    db,
    edge,
    publisher,
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

  return { app, db, close, edge, publisher, request, json };
}
