import { useRef, useState } from 'react';
import { api, type TagView } from '../api';
import {
  describeNfcError,
  getNdefReaderFactory,
  verifyAndLockTag,
  verifyTagUrl,
  writeTagUrl,
} from '../nfc';
import { useNotices } from '../notices';
import { CopyButton } from '../ui';

type Step = 'idle' | 'writing' | 'written' | 'verifying' | 'verified' | 'locking' | 'locked';

const WAIT_MS = 60_000;

/** Grabado seguro del chip físico desde Chrome en Android. */
export function NfcWriter({ tag, onLocked }: { tag: TagView; onLocked: () => void }) {
  const factory = getNdefReaderFactory();
  const { notify } = useNotices();
  const [step, setStep] = useState<Step>(tag.lockedAt ? 'locked' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const url = tag.urls.nfc;

  if (tag.lockedAt) {
    return (
      <section>
        <h2>Grabar el chip</h2>
        <div className="card">
          <p>
            🔒 Este chip ya está <strong>grabado y bloqueado</strong>. Si un día necesitas otro
            destino, cámbialo abajo: el chip no hace falta tocarlo.
          </p>
        </div>
      </section>
    );
  }

  if (!factory) {
    return (
      <section>
        <h2>Grabar el chip</h2>
        <div className="card">
          <p>
            Para grabar desde el panel, abre esta página en <strong>Chrome en un Android</strong>{' '}
            (por ejemplo tu Pixel). En iPhone o en el PC no es posible.
          </p>
          <p className="muted small">
            Alternativa: copia la URL del chip y grábala con la app <strong>NFC Tools</strong>{' '}
            (Escribir → Añadir un registro → URL). Luego bloquéalo con «Otros → Bloquear la
            etiqueta» y anótalo aquí con «Ya lo bloqueé con otra app».
          </p>
          <div className="url-box">
            <code className="truncate">{url}</code>
            <CopyButton text={url} />
          </div>
        </div>
      </section>
    );
  }

  async function run(next: Step, action: (signal: AbortSignal) => Promise<void>, done: Step) {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), WAIT_MS);
    setError(null);
    setStep(next);
    try {
      await action(ctrl.signal);
      setStep(done);
      return true;
    } catch (err) {
      setError(describeNfcError(err).message);
      setStep(next === 'writing' ? 'idle' : next === 'verifying' ? 'written' : 'verified');
      return false;
    } finally {
      clearTimeout(timer);
      if (controller.current === ctrl) controller.current = null;
    }
  }

  const write = () => run('writing', (signal) => writeTagUrl(factory, url, signal), 'written');
  const verify = () => run('verifying', (signal) => verifyTagUrl(factory, url, signal), 'verified');

  async function lock() {
    if (!confirm(`¿Bloquear el chip #${tag.number} para siempre? No se podrá volver a grabar.`)) {
      return;
    }
    const ok = await run('locking', (signal) => verifyAndLockTag(factory!, url, signal), 'locked');
    if (!ok) return;
    try {
      await api.lockTag(tag.slug);
    } catch {
      // El chip ya está bloqueado físicamente; si falla el registro, se puede anotar a mano.
    }
    notify('success', `Chip #${tag.number} bloqueado.`);
    onLocked();
  }

  const waiting = step === 'writing' || step === 'verifying' || step === 'locking';

  return (
    <section>
      <h2>Grabar el chip</h2>
      <div className="card nfc">
        {step === 'locked' ? (
          <p>
            🔒 Este chip ya está <strong>grabado y bloqueado</strong>. Si un día necesitas otro
            destino, cámbialo abajo: el chip no hace falta tocarlo.
          </p>
        ) : (
          <ol className="nfc-steps">
            <li className={stepClass(step, ['written', 'verifying', 'verified'])}>
              <strong>Grabar.</strong> Pulsa el botón y acerca el chip a la parte de atrás del
              móvil, cerca de la cámara.
              <div className="actions actions-start">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={write}
                  disabled={waiting}
                >
                  {step === 'writing' ? 'Acerca el chip…' : 'Grabar chip'}
                </button>
              </div>
            </li>
            <li className={stepClass(step, ['verified'])}>
              <strong>Comprobar.</strong> Separa el chip y vuelve a acercarlo: el móvil lee lo que
              quedó grabado.
              <div className="actions actions-start">
                <button
                  type="button"
                  className="button"
                  onClick={verify}
                  disabled={waiting || step === 'idle'}
                >
                  {step === 'verifying' ? 'Acerca el chip…' : 'Comprobar chip'}
                </button>
              </div>
            </li>
            <li>
              <strong>Bloquear (opcional y permanente).</strong> El chip no se podrá volver a grabar
              nunca. Primero prueba que funciona escaneándolo con otro móvil.
              <div className="actions actions-start">
                <button
                  type="button"
                  className="button button-danger"
                  onClick={lock}
                  disabled={step !== 'verified'}
                >
                  {step === 'locking' ? 'Acerca el chip y no lo muevas…' : 'Bloquear para siempre'}
                </button>
              </div>
              <p className="hint">
                Antes de bloquear se vuelve a leer el chip: si no tiene exactamente esta URL, no se
                bloquea.
              </p>
            </li>
          </ol>
        )}

        {waiting && (
          <div className="actions actions-start">
            <button type="button" className="button" onClick={() => controller.current?.abort()}>
              Cancelar
            </button>
          </div>
        )}
        {error && <div className="card card-warning nfc-error">{error}</div>}
        {step === 'written' && !error && <p className="nfc-ok">✓ Grabado. Ahora compruébalo.</p>}
        {step === 'verified' && <p className="nfc-ok">✓ El chip tiene la URL correcta.</p>}
      </div>
    </section>
  );
}

function stepClass(step: Step, doneWhen: Step[]): string {
  return doneWhen.includes(step) ? 'done' : '';
}
