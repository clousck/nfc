import { describe, expect, it } from 'vitest';
import { host, tagState } from '../web/src/chips.js';

const tag = (fields: Partial<Parameters<typeof tagState>[0]> = {}) => ({
  businessId: 'b_1' as string | null,
  active: true,
  published: true,
  pausedAt: null as number | null,
  lockedAt: null as number | null,
  ...fields,
});

describe('estado de un chip (rack, tablas y ficha)', () => {
  it('sin negocio está libre, aunque esté bloqueado o inactivo', () => {
    expect(tagState(tag({ businessId: null }))).toBe('free');
    expect(tagState(tag({ businessId: null, lockedAt: 1, active: false }))).toBe('free');
  });

  it('lo que requiere atención gana a estar bloqueado', () => {
    expect(tagState(tag({ pausedAt: 1, lockedAt: 1 }))).toBe('paused');
    expect(tagState(tag({ active: false, lockedAt: 1 }))).toBe('off');
    expect(tagState(tag({ published: false, lockedAt: 1 }))).toBe('missing');
  });

  it('asignado y publicado está en uso; si se grabó, bloqueado', () => {
    expect(tagState(tag())).toBe('live');
    expect(tagState(tag({ lockedAt: 1 }))).toBe('locked');
  });
});

describe('dominio del destino', () => {
  it('se queda con el dominio, sin www', () => {
    expect(host('https://www.instagram.com/cafe?x=1')).toBe('instagram.com');
    expect(host('https://g.page/r/abc/review')).toBe('g.page');
  });

  it('no falla con lo que falta o no es una URL', () => {
    expect(host(null)).toBe('');
    expect(host('no es una url')).toBe('no es una url');
  });
});
