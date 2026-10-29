// Prueba de presencia (docs/BUSINESS-ACCOUNTS.md §6): métodos intercambiables con la misma
// interfaz (patrón Strategy). El resto del código (sellos) solo ve el resultado y su fuerza.

export type PresenceMethod = 'static_nfc' | 'nfc_counter' | 'rotating_qr' | 'ntag_sun';

export type PresenceResult =
  | { proven: true; method: PresenceMethod; strength: 'weak' | 'strong'; businessId: string }
  | { proven: false; reason: 'missing' | 'expired' | 'invalid' | 'replayed' };

export interface PresenceContext {
  /** Clave maestra (secreto PRESENCE_MASTER_KEY). Sin ella, los métodos fuertes no verifican. */
  masterKey: string | undefined;
  /** Versión de la clave del QR de cada negocio (subirla invalida sus QR). */
  qrKeyVersion(businessId: string): Promise<number | null>;
}

export interface PresenceVerifier<Input> {
  readonly method: PresenceMethod;
  verify(input: Input, context: PresenceContext, now: number): Promise<PresenceResult>;
}

/** URL fija del chip: cualquiera que la copie puede abrirla. Prueba débil. */
export const staticNfc: PresenceVerifier<{ businessId: string; source: 'nfc' | 'qr' }> = {
  method: 'static_nfc',
  async verify(input) {
    return input.source === 'nfc'
      ? { proven: true, method: 'static_nfc', strength: 'weak', businessId: input.businessId }
      : { proven: false, reason: 'missing' };
  },
};

// ---------------------------------------------------------------------------------------------
// QR rotativo: /c/<businessId>.<ventana>.<firma>
//   ventana = floor(ahora / 60 s)
//   firma   = HMAC-SHA256(clave_negocio, "checkin:<businessId>:<ventana>"), 16 bytes, base64url
//   clave_negocio = HKDF(PRESENCE_MASTER_KEY, "qr:<businessId>:v<versión>"); no se guarda nada.
// Se aceptan la ventana actual y la anterior (relojes desfasados): una foto sirve ~2 minutos.

export const QR_WINDOW_MS = 60_000;
export const CHECKIN_PATH = '/c';
const BUSINESS_ID = /^[A-Za-z0-9_-]{1,64}$/;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(masterKey: string, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(masterKey), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}

async function sign(key: CryptoKey, message: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return base64url(mac.slice(0, 16));
}

/** Comparación en tiempo constante (no filtra cuántos caracteres coinciden). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function qrKey(masterKey: string, businessId: string, version: number): Promise<CryptoKey> {
  return hmacKey(masterKey, `qr:${businessId}:v${version}`);
}

/** Token del QR vigente de un negocio (lo muestra el portal o el móvil del personal). */
export async function rotatingQrToken(
  masterKey: string,
  businessId: string,
  version: number,
  now: number,
): Promise<{ token: string; expiresAt: number }> {
  const window = Math.floor(now / QR_WINDOW_MS);
  const key = await qrKey(masterKey, businessId, version);
  const sig = await sign(key, `checkin:${businessId}:${window}`);
  return { token: `${businessId}.${window}.${sig}`, expiresAt: (window + 1) * QR_WINDOW_MS };
}

export const rotatingQr: PresenceVerifier<{ token: string }> = {
  method: 'rotating_qr',
  async verify(input, context, now) {
    const parts = input.token.split('.');
    if (parts.length !== 3) return { proven: false, reason: 'invalid' };
    const [businessId, windowText, sig] = parts as [string, string, string];
    if (!BUSINESS_ID.test(businessId) || !/^\d{1,12}$/.test(windowText)) {
      return { proven: false, reason: 'invalid' };
    }
    if (!context.masterKey) return { proven: false, reason: 'invalid' };
    const version = await context.qrKeyVersion(businessId);
    if (version === null) return { proven: false, reason: 'invalid' };
    const window = Number(windowText);
    const key = await qrKey(context.masterKey, businessId, version);
    if (!safeEqual(sig, await sign(key, `checkin:${businessId}:${window}`))) {
      return { proven: false, reason: 'invalid' };
    }
    const current = Math.floor(now / QR_WINDOW_MS);
    if (window > current + 1 || window < current - 1) return { proven: false, reason: 'expired' };
    return { proven: true, method: 'rotating_qr', strength: 'strong', businessId };
  },
};

// ---------------------------------------------------------------------------------------------
// Pase de presencia: si quien escanea el QR aún no tiene tarjeta, el alta puede tardar más que
// el QR. Una cookie firmada de 10 minutos recuerda que estuvo en el local.

export const PRESENCE_PASS_COOKIE = 'nfc_presence';
export const PRESENCE_PASS_MS = 10 * 60_000;

export async function presencePass(
  masterKey: string,
  businessId: string,
  now: number,
): Promise<string> {
  const expires = now + PRESENCE_PASS_MS;
  const key = await hmacKey(masterKey, 'presence-pass');
  return `${businessId}.${expires}.${await sign(key, `pass:${businessId}:${expires}`)}`;
}

export async function verifyPresencePass(
  masterKey: string | undefined,
  value: string | null,
  businessId: string,
  now: number,
): Promise<boolean> {
  if (!masterKey || !value) return false;
  const [id, expiresText, sig] = value.split('.');
  if (id !== businessId || !expiresText || !sig || !/^\d{1,15}$/.test(expiresText)) return false;
  const expires = Number(expiresText);
  if (expires < now || expires > now + PRESENCE_PASS_MS) return false;
  const key = await hmacKey(masterKey, 'presence-pass');
  return safeEqual(sig, await sign(key, `pass:${businessId}:${expires}`));
}
