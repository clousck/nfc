import type { LinkRecord } from '@nfc/shared';

/** Copia publicada de los chips en KV `LINKS` (clave = slug). SQLite es la fuente de verdad. */
export interface LinkStore {
  putMany(entries: ReadonlyArray<{ slug: string; record: LinkRecord }>): Promise<void>;
  deleteMany(slugs: readonly string[]): Promise<void>;
  listSlugs(): Promise<string[]>;
}

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CloudflareApiError';
  }
}

interface CloudflareKvOptions {
  accountId: string;
  apiToken: string;
  namespaceId: string;
  fetch?: typeof fetch;
}

interface ApiEnvelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: T;
  result_info?: { cursor?: string };
}

const API_BASE = 'https://api.cloudflare.com/client/v4';
// Límite de la API bulk de KV por petición.
const BULK_LIMIT = 10_000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type ApiCall = <T>(method: string, path: string, body?: unknown) => Promise<ApiEnvelope<T>>;

function createApiCall(base: string, apiToken: string, doFetch: typeof fetch): ApiCall {
  return async function call<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiEnvelope<T>> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    let envelope: ApiEnvelope<T> | null = null;
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      // Respuesta no JSON; se reporta con el status HTTP.
    }
    if (!response.ok || !envelope?.success) {
      const detail = envelope?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ');
      throw new CloudflareApiError(
        `Cloudflare API ${method} ${path} → ${response.status}${detail ? ` (${detail})` : ''}`,
        response.status,
      );
    }
    return envelope;
  };
}

/** Cliente mínimo de la API REST de Workers KV (token con `Workers KV Storage:Edit`). */
export function createCloudflareKv(options: CloudflareKvOptions): LinkStore {
  const call = createApiCall(
    `${API_BASE}/accounts/${encodeURIComponent(options.accountId)}/storage/kv/namespaces/${encodeURIComponent(options.namespaceId)}`,
    options.apiToken,
    options.fetch ?? fetch,
  );

  return {
    async putMany(entries) {
      for (const part of chunk(entries, BULK_LIMIT)) {
        await call(
          'PUT',
          '/bulk',
          part.map(({ slug, record }) => ({ key: slug, value: JSON.stringify(record) })),
        );
      }
    },

    async deleteMany(slugs) {
      for (const part of chunk(slugs, BULK_LIMIT)) {
        await call('POST', '/bulk/delete', part);
      }
    },

    async listSlugs() {
      const slugs: string[] = [];
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({ limit: '1000' });
        if (cursor) query.set('cursor', cursor);
        const page = await call<Array<{ name: string }>>('GET', `/keys?${query.toString()}`);
        slugs.push(...page.result.map((key) => key.name));
        cursor = page.result_info?.cursor || undefined;
      } while (cursor);
      return slugs;
    },
  };
}

/** Consultas de solo lectura a la base D1 de escaneos (token con `D1:Read`). */
export interface ScanStore {
  query<T>(sql: string, params?: ReadonlyArray<string | number>): Promise<T[]>;
}

interface CloudflareD1Options {
  accountId: string;
  apiToken: string;
  databaseId: string;
  fetch?: typeof fetch;
}

export function createCloudflareD1(options: CloudflareD1Options): ScanStore {
  const call = createApiCall(
    `${API_BASE}/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}`,
    options.apiToken,
    options.fetch ?? fetch,
  );

  return {
    async query<T>(sql: string, params: ReadonlyArray<string | number> = []) {
      const envelope = await call<Array<{ results: T[]; success: boolean }>>('POST', '/query', {
        sql,
        params,
      });
      return envelope.result[0]?.results ?? [];
    },
  };
}

/** Se usa cuando faltan credenciales: el admin funciona, pero nada se publica. */
export function createUnconfiguredLinkStore(): LinkStore {
  const fail = async (): Promise<never> => {
    throw new CloudflareApiError(
      'Cloudflare no está configurado (CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_LINKS_NAMESPACE_ID)',
      0,
    );
  };
  return { putMany: fail, deleteMany: fail, listSlugs: fail };
}
