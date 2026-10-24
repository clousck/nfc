import { describe, expect, it } from 'vitest';
import { createHttpEdgeClient, EdgeError } from '../server/edge-client.js';

const TOKEN = 'x'.repeat(32);

function fakeFetch(response: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as typeof fetch;
  return { fn, calls };
}

const tag = {
  slug: 'aaaaaaa',
  number: 1,
  businessId: null,
  assignedAt: null,
  label: null,
  type: 'redirect' as const,
  targetUrl: null,
  active: true,
};

describe('cliente de la API interna', () => {
  it('envía el token, la ruta /internal y la revisión', async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ applied: true, written: 1, deleted: 0 }));
    const edge = createHttpEdgeClient({
      baseUrl: 'https://go.penginexr.com/',
      token: TOKEN,
      fetch: fn,
    });

    const result = await edge.putTag(tag, 42);

    expect(result).toEqual({ applied: true, written: 1, deleted: 0 });
    expect(calls[0]?.url).toBe('https://go.penginexr.com/internal/tags/aaaaaaa');
    expect(calls[0]?.init.method).toBe('PUT');
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      slug: 'aaaaaaa',
      revision: 42,
    });
  });

  it('un 404 sugiere revisar el token', async () => {
    const { fn } = fakeFetch(() => new Response('<html>', { status: 404 }));
    const edge = createHttpEdgeClient({
      baseUrl: 'https://go.penginexr.com',
      token: TOKEN,
      fetch: fn,
    });
    await expect(edge.deleteTag('aaaaaaa', 1)).rejects.toThrow(/INTERNAL_API_TOKEN/);
  });

  it('sin respuesta del Worker lanza EdgeError con status 0', async () => {
    const fn = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const edge = createHttpEdgeClient({
      baseUrl: 'https://go.penginexr.com',
      token: TOKEN,
      fetch: fn,
    });
    const error = await edge
      .sync({ revision: 1, businesses: [], tags: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EdgeError);
    expect((error as EdgeError).status).toBe(0);
  });

  it('rechaza respuestas que no cumplen el contrato', async () => {
    const { fn } = fakeFetch(() => Response.json({ algo: 'raro' }));
    const edge = createHttpEdgeClient({
      baseUrl: 'https://go.penginexr.com',
      token: TOKEN,
      fetch: fn,
    });
    await expect(edge.loyaltyCards('b_0123456789ab')).rejects.toThrow(/Respuesta inesperada/);
  });
});
