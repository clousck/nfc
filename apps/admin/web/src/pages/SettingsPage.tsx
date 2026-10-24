import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import { LoadError, Loading } from '../ui';

/** Ajustes globales de la plataforma (viven en Cloudflare). */
export function SettingsPage() {
  const settings = useResource(() => api.getAppSettings(), 'app-settings');
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
      <div className="page-title">
        <h1>Ajustes</h1>
      </div>
      <section>
        <h2>Avisos</h2>
        <div className="card">
          {settings.error ? (
            <LoadError error={settings.error} retry={settings.reload} />
          ) : !settings.data ? (
            <Loading />
          ) : (
            <form className="form" onSubmit={save} key={settings.data.adminNotifyEmail}>
              <label>
                Correo para avisos de «stand perdido»
                <input
                  className="input"
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  defaultValue={settings.data.adminNotifyEmail}
                />
              </label>
              <p className="muted small">
                Cuando un negocio marca un stand como perdido o dañado en su portal, el chip se
                pausa y llega un correo a esta dirección.
              </p>
              <div className="actions actions-start">
                <button type="submit" className="button button-primary" disabled={saving}>
                  Guardar
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
