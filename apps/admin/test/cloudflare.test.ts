import { describe, expect, it } from 'vitest';
import { CloudflareApiError, createCloudflareKv } from '../server/cloudflare.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift() ?? { body: { success: true, result: null } };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const BASE = 'https://api.cloudflare.com/client/v4/accounts/acc/storage/kv/namespaces/ns';

function client(fn: typeof fetch) {
  return createCloudflareKv({ accountId: 'acc', apiToken: 'tok', namespaceId: 'ns', fetch: fn });
}

describe('cliente KV de Cloudflare', () => {
  it('putMany usa la API bulk con valores JSON', async () => {
    const { fn, calls } = fakeFetch([]);
    await client(fn).putMany([
      {
        slug: 'aB3dE5f',
        record: {
          type: 'redirect',
          url: 'https://x.com',
          businessId: 'b_0123456789ab',
          active: true,
        },
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/bulk`,
      method: 'PUT',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: [
        {
          key: 'aB3dE5f',
          value:
            '{"type":"redirect","url":"https://x.com","businessId":"b_0123456789ab","active":true}',
        },
      ],
    });
  });

  it('deleteMany usa bulk/delete', async () => {
    const { fn, calls } = fakeFetch([]);
    await client(fn).deleteMany(['a', 'b']);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/bulk/delete`,
      method: 'POST',
      body: ['a', 'b'],
    });
  });

  it('listSlugs pagina con cursor', async () => {
    const { fn, calls } = fakeFetch([
      { body: { success: true, result: [{ name: 'a' }], result_info: { cursor: 'c1' } } },
      { body: { success: true, result: [{ name: 'b' }], result_info: { cursor: '' } } },
    ]);
    expect(await client(fn).listSlugs()).toEqual(['a', 'b']);
    expect(calls[1]?.url).toBe(`${BASE}/keys?limit=1000&cursor=c1`);
  });

  it('lanza CloudflareApiError con el detalle de la API', async () => {
    const { fn } = fakeFetch([
      { status: 403, body: { success: false, errors: [{ code: 10000, message: 'Auth error' }] } },
    ]);
    const err = await client(fn)
      .deleteMany(['a'])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudflareApiError);
    expect((err as CloudflareApiError).status).toBe(403);
    expect((err as Error).message).toContain('10000: Auth error');
  });
});
