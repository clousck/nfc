import {
  ApplyResponse,
  BusinessSettings,
  DeleteCardResponse,
  INTERNAL_PREFIX,
  LoyaltyCardsResponse,
  LoyaltyContactsResponse,
  RateLimitIncidentsResponse,
  SettingsChangesResponse,
  SyncResponse,
  TagScanStatsResponse,
  TagSettings,
  type BusinessState,
  type PutBusinessSettingsBody,
  type PutTagSettingsBody,
  type SyncBody,
  type TagState,
} from '@nfc/shared';
import type { z } from 'zod';

/**
 * Lo que la Pi necesita del plano de datos. El Worker es el único dueño de D1 y el único
 * que escribe en KV; la Pi solo le envía su estado y le pide consultas.
 */
export interface EdgeClient {
  putBusiness(business: BusinessState, revision: number): Promise<ApplyResponse>;
  deleteBusiness(id: string, revision: number): Promise<ApplyResponse>;
  putTag(tag: TagState, revision: number): Promise<ApplyResponse>;
  deleteTag(slug: string, revision: number): Promise<ApplyResponse>;
  sync(body: SyncBody): Promise<SyncResponse>;
  /** Ajustes del negocio (dueño: D1). 409 si el chip no está asignado. */
  putTagSettings(slug: string, patch: PutTagSettingsBody): Promise<TagSettings>;
  putBusinessSettings(id: string, patch: PutBusinessSettingsBody): Promise<BusinessSettings>;
  /** Ajustes cambiados desde `since` (incluido), para refrescar la copia local. */
  settingsChanges(since: number): Promise<SettingsChangesResponse>;
  tagScans(slug: string, since: number | null): Promise<TagScanStatsResponse>;
  loyaltyCards(businessId: string): Promise<LoyaltyCardsResponse>;
  loyaltyContacts(businessId: string): Promise<LoyaltyContactsResponse>;
  deleteLoyaltyCard(businessId: string, cardId: number): Promise<boolean>;
  /** Incidentes de límite de peticiones; businessId null = todos. */
  incidents(businessId: string | null, days: number): Promise<RateLimitIncidentsResponse>;
}

export class EdgeError extends Error {
  constructor(
    message: string,
    /** 0 = no hubo respuesta (red, tiempo de espera o sin configurar). */
    readonly status: number,
  ) {
    super(message);
    this.name = 'EdgeError';
  }
}

interface HttpEdgeOptions {
  /** URL pública del Worker, p. ej. https://go.penginexr.com */
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createHttpEdgeClient(options: HttpEdgeOptions): EdgeClient {
  const base = `${options.baseUrl.replace(/\/+$/, '')}${INTERNAL_PREFIX}`;
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function call<S extends z.ZodType>(
    schema: S,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<z.infer<S>> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'tiempo de espera agotado'
          : String(err);
      throw new EdgeError(`No se pudo contactar con el Worker (${reason})`, 0);
    }
    if (!response.ok) {
      // 404 sin JSON = el Worker no reconoce el token (o aún no tiene la API interna).
      const hint = response.status === 404 ? ' — revisa INTERNAL_API_TOKEN' : '';
      throw new EdgeError(`Worker ${method} ${path} → ${response.status}${hint}`, response.status);
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new EdgeError(`Respuesta inesperada del Worker en ${method} ${path}`, response.status);
    }
    return parsed.data;
  }

  const enc = encodeURIComponent;

  return {
    putBusiness: (business, revision) =>
      call(ApplyResponse, 'PUT', `/businesses/${enc(business.id)}`, { ...business, revision }),
    deleteBusiness: (id, revision) =>
      call(ApplyResponse, 'DELETE', `/businesses/${enc(id)}?revision=${revision}`),
    putTag: (tag, revision) =>
      call(ApplyResponse, 'PUT', `/tags/${enc(tag.slug)}`, { ...tag, revision }),
    deleteTag: (slug, revision) =>
      call(ApplyResponse, 'DELETE', `/tags/${enc(slug)}?revision=${revision}`),
    sync: (body) => call(SyncResponse, 'POST', '/sync', body),
    putTagSettings: (slug, patch) => call(TagSettings, 'PUT', `/tags/${enc(slug)}/settings`, patch),
    putBusinessSettings: (id, patch) =>
      call(BusinessSettings, 'PUT', `/businesses/${enc(id)}/settings`, patch),
    settingsChanges: (since) => call(SettingsChangesResponse, 'GET', `/settings?since=${since}`),
    tagScans: (slug, since) =>
      call(
        TagScanStatsResponse,
        'GET',
        `/tags/${enc(slug)}/scans${since === null ? '' : `?since=${since}`}`,
      ),
    loyaltyCards: (id) => call(LoyaltyCardsResponse, 'GET', `/businesses/${enc(id)}/loyalty/cards`),
    loyaltyContacts: (id) =>
      call(LoyaltyContactsResponse, 'GET', `/businesses/${enc(id)}/loyalty/contacts`),
    incidents: (businessId, days) =>
      call(
        RateLimitIncidentsResponse,
        'GET',
        `/incidents?days=${days}${businessId ? `&businessId=${enc(businessId)}` : ''}`,
      ),
    deleteLoyaltyCard: async (id, cardId) =>
      (await call(DeleteCardResponse, 'DELETE', `/businesses/${enc(id)}/loyalty/cards/${cardId}`))
        .deleted,
  };
}

/** Sin INTERNAL_API_TOKEN: el panel funciona y los cambios esperan en la cola. */
export function createUnconfiguredEdgeClient(): EdgeClient {
  const fail = async (): Promise<never> => {
    throw new EdgeError('Falta configurar INTERNAL_API_TOKEN en la Pi', 0);
  };
  return {
    putBusiness: fail,
    deleteBusiness: fail,
    putTag: fail,
    deleteTag: fail,
    sync: fail,
    putTagSettings: fail,
    putBusinessSettings: fail,
    settingsChanges: fail,
    tagScans: fail,
    loyaltyCards: fail,
    loyaltyContacts: fail,
    deleteLoyaltyCard: fail,
    incidents: fail,
  };
}
