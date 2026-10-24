import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

type Ctx = ReturnType<typeof setup>;
let ctx: Ctx;

beforeEach(() => {
  ctx = setup();
});

afterEach(() => ctx.close());

describe('móviles del personal', () => {
  it('lista, crea el enlace de vinculación y revoca', async () => {
    const { id } = (await ctx.json<{ id: string }>('POST', '/api/businesses', { name: 'Café' }))
      .body;
    ctx.edge.staffByBusiness.set(id, [
      { id: 'd_000000000001', label: 'Caja', createdAt: 1, createdBy: null, lastUsedAt: null },
    ]);
    const list = await ctx.json<{ devices: unknown[] }>('GET', `/api/businesses/${id}/staff`);
    expect(list.body.devices).toHaveLength(1);

    const pairing = await ctx.json<{ url: string }>('POST', `/api/businesses/${id}/staff/pairing`, {
      label: 'Barra',
    });
    expect(pairing.body.url).toMatch(/^https:\/\/go\.penginexr\.com\/vincular\//);

    const revoked = await ctx.request('DELETE', `/api/businesses/${id}/staff/d_000000000001`);
    expect(revoked.status).toBe(200);
    expect((await ctx.request('DELETE', `/api/businesses/${id}/staff/d_000000000001`)).status).toBe(
      409,
    );
  });

  it('valida el nombre del móvil', async () => {
    const { id } = (await ctx.json<{ id: string }>('POST', '/api/businesses', { name: 'Café' }))
      .body;
    const res = await ctx.request('POST', `/api/businesses/${id}/staff/pairing`, { label: '' });
    expect(res.status).toBe(400);
  });
});

describe('ajustes', () => {
  it('lee y cambia el correo de avisos', async () => {
    const before = await ctx.json<{ adminNotifyEmail: string }>('GET', '/api/app-settings');
    expect(before.body.adminNotifyEmail).toBe('victor.ees.ec@gmail.com');
    const after = await ctx.json('PUT', '/api/app-settings', { adminNotifyEmail: 'Yo@Correo.ec' });
    expect(after.body).toEqual({ adminNotifyEmail: 'yo@correo.ec' });
    expect((await ctx.request('PUT', '/api/app-settings', { adminNotifyEmail: 'x' })).status).toBe(
      400,
    );
  });
});
