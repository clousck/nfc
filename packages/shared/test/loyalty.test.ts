import { describe, expect, it } from 'vitest';
import {
  BusinessRecord,
  formatRedemptionCode,
  generateRedemptionCode,
  LinkRecord,
  maskPhone,
  normalizePhone,
  parseRedemptionCode,
  REDEMPTION_CODE_PATTERN,
} from '../src/index.js';

describe('normalizePhone', () => {
  it('acepta formatos de Ecuador', () => {
    expect(normalizePhone('0991234567')).toBe('+593991234567');
    expect(normalizePhone('099 123 4567')).toBe('+593991234567');
    expect(normalizePhone('991234567')).toBe('+593991234567');
    expect(normalizePhone('+593 99 123 4567')).toBe('+593991234567');
    expect(normalizePhone('00593991234567')).toBe('+593991234567');
  });

  it('acepta números internacionales', () => {
    expect(normalizePhone('+34 600-000-000')).toBe('+34600000000');
  });

  it('rechaza lo que no es un teléfono', () => {
    for (const bad of ['', 'hola', '12345', '+0123456789', '099123', '+1234567890123456']) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });

  it('oculta parte del número', () => {
    expect(maskPhone('+593991234567')).toBe('+593 99 *** 4567');
  });
});

describe('códigos de canje', () => {
  it('son de 8 caracteres sin ambiguos y distintos', () => {
    const codes = new Set(Array.from({ length: 300 }, generateRedemptionCode));
    expect(codes.size).toBe(300);
    for (const code of codes) {
      expect(code).toMatch(REDEMPTION_CODE_PATTERN);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('se formatean y se leen tal como los teclea el cajero', () => {
    expect(formatRedemptionCode('K7PQ42XZ')).toBe('K7PQ-42XZ');
    expect(parseRedemptionCode(' k7pq-42xz ')).toBe('K7PQ42XZ');
    expect(parseRedemptionCode('K7PQ-42X')).toBeNull();
    expect(parseRedemptionCode('K7PQ-42X0')).toBeNull();
  });
});

describe('schemas de fidelidad', () => {
  it('LinkRecord admite chips de fidelidad con o sin destino', () => {
    const base = { type: 'loyalty', businessId: 'b_0123456789ab', active: true };
    expect(LinkRecord.safeParse({ ...base, url: null }).success).toBe(true);
    expect(LinkRecord.safeParse({ ...base, url: 'https://wa.me/593' }).success).toBe(true);
    expect(LinkRecord.safeParse({ ...base, url: 'http://x.com' }).success).toBe(false);
  });

  it('BusinessRecord limita las visitas necesarias', () => {
    expect(BusinessRecord.safeParse({ name: 'X', loyaltyVisits: 6 }).success).toBe(true);
    expect(BusinessRecord.safeParse({ name: 'X', loyaltyVisits: null }).success).toBe(true);
    expect(BusinessRecord.safeParse({ name: 'X', loyaltyVisits: 1 }).success).toBe(false);
    expect(BusinessRecord.safeParse({ name: 'X', loyaltyVisits: 21 }).success).toBe(false);
  });
});
