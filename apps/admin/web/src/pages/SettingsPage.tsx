import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { RateLimitIncidents } from '../components/RateLimitIncidents';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import { formatDate, LoadError, Loading, PageHead } from '../ui';

/** Ajustes globales de la plataforma (viven en Cloudflare) y estado de la publicación. */
export function SettingsPage() {
  const settings = useResource(() => api.getAppSettings(), 'app-settings');
  const status = useResource(api.syncStatus, 'sync-status:settings');
  const { notify, reportError } = useNotices();
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    setSaving(true);
    try {
      await api.saveAppSettings({ adminNotifyEmail: email });
      notify('success', 'Guardado.');
      settings.reload();
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHead title="Ajustes" sub="Avisos, publicación en Cloudflare y límites de peticiones." />

      <div className="setting">
        <div className="setting-label">
          <h2>Avisos de «stand perdido»</h2>
          <p>
            Cuando un negocio marca un stand como perdido o dañado en su portal, el chip se pausa y
            llega un correo a esta dirección.
          </p>
        </div>
        <div className="card">
          {settings.error ? (
            <LoadError error={settings.error} retry={settings.reload} />
          ) : !settings.data ? (
            <Loading />
          ) : (
            <form className="form" onSubmit={save} key={settings.data.adminNotifyEmail}>
              <label>
                Correo
                <input
                  className="input"
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  defaultValue={settings.data.adminNotifyEmail}
                />
              </label>
              <div className="actions">
                <button type="submit" className="button button-primary" disabled={saving}>
                  Guardar
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="setting">
        <div className="setting-label">
          <h2>Publicación en Cloudflare</h2>
          <p>
            Los cambios del panel se envían al Worker. Si falla, quedan en cola y se reintentan
            solos; «Re-sincronizar todo», en la barra lateral, vuelve a publicarlo todo.
          </p>
        </div>
        <div className="card">
          {status.error ? (
            <LoadError error={status.error} retry={status.reload} />
          ) : !status.data ? (
            <Loading />
          ) : (
            <dl className="facts">
              <div>
                <dt>Cambios pendientes</dt>
                <dd className="num">{status.data.pending}</dd>
              </div>
              <div>
                <dt>Con errores</dt>
                <dd className="num">{status.data.failing}</dd>
              </div>
              <div>
                <dt>Próximo intento</dt>
                <dd>{formatDate(status.data.nextAttemptAt)}</dd>
              </div>
              <div className="facts-notes">
                <dt>Último error</dt>
                <dd>{status.data.lastError ?? '—'}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      <div className="setting">
        <div className="setting-label">
          <h2>Límites de peticiones</h2>
          <p>
            Veces que se superó un límite en los últimos 30 días. En modo observación no se bloquea
            a nadie: sirve para ajustar los límites antes de activarlos.
          </p>
        </div>
        <RateLimitIncidents title={null} />
      </div>
    </>
  );
}
