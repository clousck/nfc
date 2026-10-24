import { describe, expect, it } from 'vitest';
import {
  businessOwner,
  projectAll,
  projectBusiness,
  projectTag,
  tagOwner,
  type BusinessState,
  type TagState,
} from '../src/index.js';

const business: BusinessState = {
  id: 'b_0123456789ab',
  name: 'Café X',
  status: 'active',
  reportToken: 'A'.repeat(24),
  loyaltyVisits: null,
};

const tag = (overrides: Partial<TagState> = {}): TagState => ({
  slug: 'aaaaaaa',
  number: 1,
  businessId: business.id,
  assignedAt: 100,
  label: null,
  type: 'redirect',
  targetUrl: 'https://x.ec',
  active: true,
  ...overrides,
});

describe('projectTag', () => {
  it('publica un redirect asignado con destino', () => {
    expect(projectTag(tag(), business)).toEqual({
      type: 'redirect',
      url: 'https://x.ec',
      businessId: business.id,
      active: true,
    });
  });

  it('no publica chips libres ni redirects sin destino', () => {
    expect(projectTag(tag({ businessId: null }), null)).toBeNull();
    expect(projectTag(tag({ targetUrl: null }), business)).toBeNull();
  });

  it('un negocio pausado publica sus chips inactivos', () => {
    expect(projectTag(tag(), { ...business, status: 'paused' })?.active).toBe(false);
  });

  it('no mezcla un chip con un negocio que no es el suyo', () => {
    expect(projectTag(tag({ businessId: 'b_otronegocio1' }), business)).toBeNull();
  });
});

describe('projectBusiness', () => {
  it('incluye sus chips ordenados por número y nada de otros negocios', () => {
    const entries = projectBusiness(business, [
      tag({ slug: 'bbbbbbb', number: 2 }),
      tag({ slug: 'ccccccc', number: 3, businessId: 'b_otronegocio1' }),
      tag({ slug: 'aaaaaaa', number: 1 }),
    ]);
    const report = entries.find((e) => e.key.startsWith('report:'))?.value as {
      tags: Array<{ slug: string }>;
    };
    expect(report.tags.map((t) => t.slug)).toEqual(['aaaaaaa', 'bbbbbbb']);
  });

  it('un negocio cancelado o sin token no tiene enlace de estadísticas', () => {
    expect(projectBusiness({ ...business, status: 'cancelled' }, []).map((e) => e.key)).toEqual([
      `business:${business.id}`,
    ]);
    expect(projectBusiness({ ...business, reportToken: null }, [])).toHaveLength(1);
  });
});

describe('projectAll', () => {
  it('asigna cada clave a su dueño', () => {
    const all = projectAll([business], [tag(), tag({ slug: 'zzzzzzz', businessId: null })]);
    expect([...all.keys()].sort()).toEqual(
      ['aaaaaaa', `business:${business.id}`, `report:${'A'.repeat(24)}`].sort(),
    );
    expect(all.get('aaaaaaa')?.owner).toBe(tagOwner('aaaaaaa'));
    expect(all.get(`business:${business.id}`)?.owner).toBe(businessOwner(business.id));
  });
});
