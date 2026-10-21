/**
 * Grabado y bloqueo de chips con Web NFC (Chrome en Android).
 *
 * Reglas de seguridad:
 * - Solo se graba la URL del chip que se está viendo en el panel.
 * - Tras grabar, se vuelve a leer el chip y se compara con la URL esperada.
 * - El bloqueo (irreversible) solo ocurre si, en ese mismo acercamiento, el chip
 *   contiene exactamente la URL esperada. Si no coincide, no se bloquea.
 */

// Tipos mínimos de Web NFC (no incluidos en lib.dom).
export interface NdefRecord {
  recordType: string;
  data?: DataView;
}
export interface NdefReadingEvent extends Event {
  serialNumber: string;
  message: { records: NdefRecord[] };
}
export interface NdefReaderLike extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(
    message: { records: Array<{ recordType: 'url'; data: string }> },
    options?: { signal?: AbortSignal; overwrite?: boolean },
  ): Promise<void>;
  makeReadOnly(options?: { signal?: AbortSignal }): Promise<void>;
}
export type NdefReaderFactory = () => NdefReaderLike;

export function getNdefReaderFactory(): NdefReaderFactory | null {
  const ctor = (globalThis as { NDEFReader?: new () => NdefReaderLike }).NDEFReader;
  return ctor ? () => new ctor() : null;
}

export class NfcError extends Error {
  constructor(
    message: string,
    readonly code: 'mismatch' | 'empty' | 'timeout' | 'denied' | 'readonly' | 'unknown',
  ) {
    super(message);
    this.name = 'NfcError';
  }
}

/** Traduce los errores del navegador a mensajes entendibles. */
export function describeNfcError(err: unknown): NfcError {
  if (err instanceof NfcError) return err;
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') {
    return new NfcError(
      'Chrome no tiene permiso para usar NFC, o el chip está bloqueado y no se puede grabar.',
      'denied',
    );
  }
  if (name === 'NotSupportedError') {
    return new NfcError('Este móvil no tiene NFC o está desactivado en los ajustes.', 'denied');
  }
  if (name === 'NetworkError') {
    return new NfcError(
      'Se perdió el contacto con el chip. Mantenlo quieto contra el móvil e inténtalo de nuevo.',
      'unknown',
    );
  }
  if (name === 'AbortError') return new NfcError('Operación cancelada.', 'timeout');
  return new NfcError(err instanceof Error ? err.message : String(err), 'unknown');
}

/** URL del primer registro de tipo URL del chip, o null si no tiene. */
export function urlFromRecords(records: readonly NdefRecord[]): string | null {
  const record = records.find((r) => r.recordType === 'url' || r.recordType === 'absolute-url');
  if (!record?.data) return null;
  return new TextDecoder().decode(record.data);
}

/** Espera el próximo acercamiento de un chip y devuelve su URL (o null si está vacío). */
export function readNextTag(
  reader: NdefReaderLike,
  signal: AbortSignal,
): Promise<{ url: string | null; serialNumber: string }> {
  return new Promise((resolve, reject) => {
    const onReading = (event: Event) => {
      cleanup();
      const e = event as NdefReadingEvent;
      resolve({ url: urlFromRecords(e.message.records), serialNumber: e.serialNumber });
    };
    const onError = () => {
      cleanup();
      reject(new NfcError('No se pudo leer el chip. Inténtalo de nuevo.', 'unknown'));
    };
    const onAbort = () => {
      cleanup();
      reject(new NfcError('Operación cancelada.', 'timeout'));
    };
    const cleanup = () => {
      reader.removeEventListener('reading', onReading);
      reader.removeEventListener('readingerror', onError);
      signal.removeEventListener('abort', onAbort);
    };
    reader.addEventListener('reading', onReading);
    reader.addEventListener('readingerror', onError);
    signal.addEventListener('abort', onAbort);
    reader.scan({ signal }).catch((err: unknown) => {
      cleanup();
      reject(describeNfcError(err));
    });
  });
}

/** Paso 1: graba la URL en el próximo chip que se acerque. */
export async function writeTagUrl(
  factory: NdefReaderFactory,
  url: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await factory().write({ records: [{ recordType: 'url', data: url }] }, { signal });
  } catch (err) {
    throw describeNfcError(err);
  }
}

/** Paso 2: lee el chip y confirma que tiene exactamente la URL esperada. */
export async function verifyTagUrl(
  factory: NdefReaderFactory,
  expected: string,
  signal: AbortSignal,
): Promise<void> {
  const { url } = await readNextTag(factory(), signal);
  if (url === null)
    throw new NfcError('El chip está vacío: no tiene ninguna URL grabada.', 'empty');
  if (url !== expected) {
    throw new NfcError(`El chip tiene otra URL (${url}). No es este chip.`, 'mismatch');
  }
}

/**
 * Paso 3 (irreversible): lee el chip y, SOLO si contiene la URL esperada, lo bloquea
 * en ese mismo acercamiento. Si la URL no coincide, no toca el chip.
 */
export async function verifyAndLockTag(
  factory: NdefReaderFactory,
  expected: string,
  signal: AbortSignal,
): Promise<void> {
  const reader = factory();
  const { url } = await readNextTag(reader, signal);
  if (url !== expected) {
    throw new NfcError(
      url === null
        ? 'El chip está vacío. No se bloqueó.'
        : `El chip tiene otra URL (${url}). No se bloqueó.`,
      'mismatch',
    );
  }
  try {
    await reader.makeReadOnly({ signal });
  } catch (err) {
    throw describeNfcError(err);
  }
}
