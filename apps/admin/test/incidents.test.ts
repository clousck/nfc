import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: ReturnType<typeof setup>;

beforeEach(() => {
  ctx = setup();
});

afterEach(() => {
  ctx.close();
});

const incident = (businessId: string) => ({
  businessId,
  day: '2026-10-24',
  action: 'validate' as const,
  actor: 'anonymous' as const,
  scope: 'network' as const,
  mode: 'observe' as const,
  minutes: 2,
  sources: 1,
  lastAt: 1,
});

describe('incidentes de límite de peticiones', () => {
  it('por negocio, con su nombre', async () => {
    const { body: business } = await ctx.json<{ id: string }>('POST', '/api/businesses', {
      name: 'Café X',
    });
    ctx.edge.incidentList = [incident(business.id), incident('b_otronegocio1')];

    const res = await ctx.json<{ mode: string; incidents: Array<{ businessName: string }> }>(
      'GET',
      `/api/businesses/${business.id}/incidents`,
    );

    expect(res.body.mode).toBe('observe');
    expect(res.body.incidents).toEqual([expect.objectContaining({ businessName: 'Café X' })]);
  });

  it('en la vista general, los de negocio desconocido llegan con businessId null', async () => {
    ctx.edge.incidentList = [incident('')];
    const res = await ctx.json<{ incidents: Array<{ businessId: string | null }> }>(
      'GET',
      '/api/incidents',
    );
    expect(res.body.incidents).toEqual([expect.objectContaining({ businessId: null })]);
  });

  it('si el Worker falla responde 502', async () => {
    ctx.edge.failing = true;
    expect((await ctx.request('GET', '/api/incidents')).status).toBe(502);
  });
});
