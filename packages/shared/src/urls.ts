import type { ScanSource } from './schemas.js';

/** Parámetro que distingue el QR impreso del chip NFC. */
export const SOURCE_PARAM = 's';
export const QR_SOURCE_VALUE = 'q';

export interface TagUrls {
  /** URL grabada en el chip (lo más corta posible, cabe en NTAG213). */
  nfc: string;
  /** URL del QR impreso, marcada con `?s=q`. */
  qr: string;
}

export function buildTagUrls(baseUrl: string, slug: string): TagUrls {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    nfc: `${base}/${slug}`,
    qr: `${base}/${slug}?${SOURCE_PARAM}=${QR_SOURCE_VALUE}`,
  };
}

export function sourceFromParam(value: string | null | undefined): ScanSource {
  return value === QR_SOURCE_VALUE ? 'qr' : 'nfc';
}
