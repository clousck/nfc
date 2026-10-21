import { describe, expect, it } from 'vitest';
import {
  describeNfcError,
  NfcError,
  urlFromRecords,
  verifyAndLockTag,
  verifyTagUrl,
  writeTagUrl,
  type NdefReaderLike,
} from '../web/src/nfc.js';

const URL_OK = 'https://go.penginexr.com/aB3dE5f';

/** Chip simulado: al llamar a scan(), "acerca" un chip con la URL indicada. */
class FakeReader extends EventTarget implements NdefReaderLike {
  locked = false;
  written: string | null = null;

  constructor(
    private readonly tagUrl: string | null,
    private readonly fail?: DOMException,
  ) {
    super();
  }

  async scan() {
    if (this.fail) throw this.fail;
    queueMicrotask(() => {
      const event = new Event('reading') as Event & {
        serialNumber: string;
        message: { records: Array<{ recordType: string; data?: DataView }> };
      };
      event.serialNumber = '04:aa:bb';
      const records =
        this.tagUrl === null
          ? []
          : [
              {
                recordType: 'url',
                data: new DataView(new TextEncoder().encode(this.tagUrl).buffer),
              },
            ];
      event.message = { records };
      this.dispatchEvent(event);
    });
  }

  async write(message: { records: Array<{ data: string }> }) {
    if (this.fail) throw this.fail;
    this.written = message.records[0]?.data ?? null;
  }

  async makeReadOnly() {
    if (this.fail) throw this.fail;
    this.locked = true;
  }
}

const signal = () => new AbortController().signal;

describe('grabado de chips (Web NFC)', () => {
  it('graba exactamente la URL del chip', async () => {
    const reader = new FakeReader(null);
    await writeTagUrl(() => reader, URL_OK, signal());
    expect(reader.written).toBe(URL_OK);
  });

  it('verifica cuando el chip tiene la URL esperada', async () => {
    await expect(verifyTagUrl(() => new FakeReader(URL_OK), URL_OK, signal())).resolves.toBe(
      undefined,
    );
  });

  it('la verificación falla si el chip tiene otra URL o está vacío', async () => {
    await expect(
      verifyTagUrl(() => new FakeReader('https://otro.com'), URL_OK, signal()),
    ).rejects.toMatchObject({ code: 'mismatch' });
    await expect(verifyTagUrl(() => new FakeReader(null), URL_OK, signal())).rejects.toMatchObject({
      code: 'empty',
    });
  });

  it('bloquea solo si el chip tiene la URL esperada', async () => {
    const reader = new FakeReader(URL_OK);
    await verifyAndLockTag(() => reader, URL_OK, signal());
    expect(reader.locked).toBe(true);
  });

  it('NUNCA bloquea un chip con otra URL', async () => {
    const reader = new FakeReader('https://go.penginexr.com/OTROchp');
    await expect(verifyAndLockTag(() => reader, URL_OK, signal())).rejects.toBeInstanceOf(NfcError);
    expect(reader.locked).toBe(false);
  });

  it('NUNCA bloquea un chip vacío', async () => {
    const reader = new FakeReader(null);
    await expect(verifyAndLockTag(() => reader, URL_OK, signal())).rejects.toMatchObject({
      code: 'mismatch',
    });
    expect(reader.locked).toBe(false);
  });

  it('cancelar detiene la espera del chip', async () => {
    const controller = new AbortController();
    const reader = new FakeReader(URL_OK);
    reader.scan = async () => {}; // nunca se acerca un chip
    const pending = verifyAndLockTag(() => reader, URL_OK, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    expect(reader.locked).toBe(false);
  });

  it('traduce los errores del navegador', () => {
    expect(describeNfcError(new DOMException('x', 'NotAllowedError')).code).toBe('denied');
    expect(describeNfcError(new DOMException('x', 'NotSupportedError')).message).toContain(
      'no tiene NFC',
    );
    expect(describeNfcError(new DOMException('x', 'NetworkError')).message).toContain(
      'contacto con el chip',
    );
  });

  it('lee la URL del primer registro de tipo URL', () => {
    const data = new DataView(new TextEncoder().encode(URL_OK).buffer);
    expect(
      urlFromRecords([
        { recordType: 'text', data },
        { recordType: 'url', data },
      ]),
    ).toBe(URL_OK);
    expect(urlFromRecords([])).toBeNull();
  });
});
