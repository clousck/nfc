import { z } from 'zod';

/** Días sin visitas tras los que la tarjeta vuelve a 0 sellos. */
export const LOYALTY_EXPIRY_DAYS = 90;
export const LOYALTY_MIN_VISITS = 2;
export const LOYALTY_MAX_VISITS = 20;

export const LoyaltyVisits = z.number().int().min(LOYALTY_MIN_VISITS).max(LOYALTY_MAX_VISITS);

/**
 * Valor publicado en KV `LINKS` bajo `business:<businessId>`: lo que el Worker necesita
 * para las páginas de fidelidad. `loyaltyVisits` null = programa desactivado.
 */
export const BusinessRecord = z.object({
  name: z.string().min(1).max(120),
  loyaltyVisits: LoyaltyVisits.nullable(),
});
export type BusinessRecord = z.infer<typeof BusinessRecord>;

export function businessKey(businessId: string): string {
  return `business:${businessId}`;
}

/**
 * Normaliza un teléfono a E.164. Acepta formatos de Ecuador (0991234567, 991234567)
 * e internacionales (+34 600 000 000, 0034…). Devuelve null si no es válido.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim().replace(/[\s\-().]/g, '');
  let digits: string;
  if (raw.startsWith('+')) digits = raw.slice(1);
  else if (raw.startsWith('00')) digits = raw.slice(2);
  else if (/^0\d{9}$/.test(raw))
    digits = `593${raw.slice(1)}`; // 09XXXXXXXX
  else if (/^9\d{8}$/.test(raw))
    digits = `593${raw}`; // 9XXXXXXXX
  else return null;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

/** Teléfono parcialmente oculto para mostrar en pantalla: +593 99 *** 4567. */
export function maskPhone(e164: string): string {
  const tail = e164.slice(-4);
  const head = e164.startsWith('+593') ? `+593 ${e164.slice(4, 6)}` : e164.slice(0, 4);
  return `${head} *** ${tail}`;
}

// Sin 0/O ni 1/I/L para que el cajero pueda dictarlo o teclearlo sin errores.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REDEMPTION_CODE_PATTERN = /^[2-9A-HJKMNP-Z]{8}$/;

/** Código de canje de 8 caracteres (~40 bits), sin caracteres ambiguos. */
export function generateRedemptionCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  while (out.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === 8) break;
    }
  }
  return out;
}

/** Normaliza lo que teclea el cajero: "k7pq-42xz" → "K7PQ42XZ". */
export function parseRedemptionCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return REDEMPTION_CODE_PATTERN.test(code) ? code : null;
}

export function formatRedemptionCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
