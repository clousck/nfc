import { randomBase62 } from '@nfc/shared';

/** Cookie que identifica el navegador del cliente (su tarjeta en cada negocio). */
export const DEVICE_COOKIE = 'nfc_dev';
/** Cookie que marca un móvil del personal como validador de canjes (valor = token del reporte). */
export const STAFF_COOKIE = 'nfc_staff';

// 400 días: el máximo que Chrome permite; se renueva en cada visita.
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function cookieHeader(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

const DEVICE_TOKEN_PATTERN = /^[0-9A-Za-z]{32}$/;

export function newDeviceToken(): string {
  return randomBase62(32);
}

/** Token del dispositivo si la cookie existe y tiene el formato esperado. */
export function readDeviceToken(request: Request): string | null {
  const token = readCookie(request, DEVICE_COOKIE);
  return token && DEVICE_TOKEN_PATTERN.test(token) ? token : null;
}

/** En la base solo se guarda el hash: una copia de la base no permite suplantar móviles. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Los formularios solo se aceptan desde nuestras propias páginas (protección CSRF):
 * el navegador indica el origen en `Origin` y/o `Sec-Fetch-Site`.
 */
export function isSameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === url.host;
    } catch {
      return false;
    }
  }
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}
