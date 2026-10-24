import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;

beforeEach(() => {
  ctx = setup();
});

afterEach(() => ctx.close());

async function business() {
  return (await ctx.json<{ id: string }>('POST', '/api/businesses', { name: 'Café X' })).body;
}

describe('cuentas de los dueños', () => {
  it('crea, lista, copia el enlace y quita el acceso', async () => {
    const { id } = await business();
    const created = await ctx.json<{ id: string; email: string }>(
      'POST',
      `/api/businesses/${id}/accounts`,
      { email: 'Ana@Cafe.ec', name: 'Ana' },
    );
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('ana@cafe.ec');

    const list = await ctx.json<{ accounts: unknown[] }>('GET', `/api/businesses/${id}/accounts`);
    expect(list.body.accounts).toHaveLength(1);

    const link = await ctx.json<{ url: string }>(
      'POST',
      `/api/businesses/${id}/accounts/${created.body.id}/login-link`,
    );
    expect(link.body.url).toMatch(/^https:\/\/negocios\.penginexr\.com\/entrar\//);

    const removed = await ctx.request(
      'DELETE',
      `/api/businesses/${id}/accounts/${created.body.id}`,
    );
    expect(removed.status).toBe(200);
  });

  it('mensajes claros: ya tiene acceso, negocio sin publicar, Worker caído', async () => {
    const { id } = await business();
    await ctx.json('POST', `/api/businesses/${id}/accounts`, { email: 'a@b.ec' });
    const dup = await ctx.json<{ error: string }>('POST', `/api/businesses/${id}/accounts`, {
      email: 'a@b.ec',
    });
    expect(dup).toMatchObject({ status: 409, body: { error: 'already_member' } });

    ctx.edge.reset();
    const unpublished = await ctx.json<{ error: string }>(
      'POST',
      `/api/businesses/${id}/accounts`,
      {
        email: 'c@d.ec',
      },
    );
    expect(unpublished.body.error).toBe('not_published');

    ctx.edge.failing = true;
    expect((await ctx.request('GET', `/api/businesses/${id}/accounts`)).status).toBe(502);
  });

  it('valida el correo y el negocio', async () => {
    const { id } = await business();
    expect(
      (await ctx.request('POST', `/api/businesses/${id}/accounts`, { email: 'x' })).status,
    ).toBe(400);
    expect((await ctx.request('GET', '/api/businesses/b_noexiste0000/accounts')).status).toBe(404);
  });
});
