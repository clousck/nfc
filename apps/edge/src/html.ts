/** Escapa texto para insertarlo en HTML (contenido y atributos). */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const TIME_ZONE = 'America/Guayaquil';

export const NO_STORE = 'no-store';

/** Cabeceras comunes de las páginas HTML que no deben cachearse ni indexarse. */
export function pageHeaders(csp: string): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': NO_STORE,
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
    'content-security-policy': csp,
  };
}

export const STRICT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
