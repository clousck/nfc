const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const SLUG_MIN_LENGTH = 6;
export const SLUG_MAX_LENGTH = 7;
export const DEFAULT_SLUG_LENGTH = 7;
export const SLUG_PATTERN = /^[0-9A-Za-z]{6,7}$/;

/** Cadena base62 aleatoria, sin sesgo de módulo (rejection sampling). */
export function randomBase62(length: number): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError('length debe ser un entero positivo');
  }
  // 248 = 62 * 4: los bytes >= 248 se descartan para que cada carácter sea equiprobable.
  const limit = 248;
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < limit) {
        out += BASE62[byte % 62];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export function generateSlug(length: number = DEFAULT_SLUG_LENGTH): string {
  if (length < SLUG_MIN_LENGTH || length > SLUG_MAX_LENGTH) {
    throw new RangeError(
      `El slug debe tener entre ${SLUG_MIN_LENGTH} y ${SLUG_MAX_LENGTH} caracteres`,
    );
  }
  return randomBase62(length);
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/** IDs con prefijo, p. ej. `b_7fK2pQx9Lm3a`. */
export function generateId(prefix: string, length = 12): string {
  return `${prefix}_${randomBase62(length)}`;
}
