import { useState, type FormEvent } from 'react';
import { api, type BusinessDetail, type Pairing, type StaffDevice } from '../api';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import { CopyButton, formatDate, LoadError, Loading } from '../ui';

/**
 * Móviles del local que validan canjes. Normalmente los vincula el dueño desde el portal
 * (que muestra el QR); aquí se pueden ver, revocar o crear un enlace para enviarlo.
 */
export function StaffDevices({ business }: { business: BusinessDetail }) {
  const devices = useResource(() => api.listStaff(business.id), business.id);
  const { notify, reportError } = useNotices();
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<(Pairing & { label: string }) | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const label = String(new FormData(formElement).get('label') ?? '').trim();
    setBusy(true);
    try {
      setPairing({ ...(await api.createPairing(business.id, label)), label });
      formElement.reset();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: StaffDevice) {
    if (!confirm(`¿Desvincular «${device.label}»? Dejará de validar canjes al instante.`)) return;
    setBusy(true);
    try {
      await api.revokeStaff(business.id, device.id);
      notify('success', 'Móvil desvinculado.');
      devices.reload();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Móviles del personal</h2>
      <div className="card">
        <p className="muted small">
          Validan los canjes del programa de fidelidad. Cada uno es revocable por separado y cada
          canje registra qué móvil lo validó.
        </p>
        {devices.error ? (
          <LoadError error={devices.error} retry={devices.reload} />
        ) : !devices.data ? (
          <Loading />
        ) : devices.data.devices.length === 0 ? (
          <p className="muted">Ningún móvil vinculado.</p>
        ) : (
          <ul className="list">
            {devices.data.devices.map((device) => (
              <li key={device.id} className="list-item">
                <span className="truncate">
                  {device.label}
                  <span className="muted small">
                    {' '}
                    · {device.createdBy ?? 'admin'} ·{' '}
                    {device.lastUsedAt
                      ? `último uso ${formatDate(device.lastUsedAt)}`
                      : 'sin usar todavía'}
                  </span>
                </span>
                <button
                  type="button"
                  className="button button-small button-danger"
                  disabled={busy}
                  onClick={() => void revoke(device)}
                >
                  Desvincular
                </button>
              </li>
            ))}
          </ul>
        )}

        {pairing && (
          <div className="card card-info">
            <p className="small">
              Enlace para vincular <strong>{pairing.label}</strong>: ábrelo en ese móvil antes del{' '}
              {formatDate(pairing.expiresAt)}. Sirve una sola vez.
            </p>
            <div className="url-box">
              <code className="truncate">{pairing.url}</code>
              <CopyButton text={pairing.url} />
            </div>
          </div>
        )}

        <form className="form-inline" onSubmit={create}>
          <label className="grow">
            Nombre del móvil
            <input
              className="input"
              name="label"
              required
              maxLength={60}
              placeholder="Caja – María"
            />
          </label>
          <button type="submit" className="button" disabled={busy}>
            Crear enlace de vinculación
          </button>
        </form>
      </div>
    </section>
  );
}
