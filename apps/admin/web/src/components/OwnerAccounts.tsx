import { useState, type FormEvent } from 'react';
import { api, type Account, type BusinessDetail, type LoginLink } from '../api';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import { CopyButton, emptyToNull, formatDate, LoadError, Loading } from '../ui';

/**
 * Quién puede entrar al portal del negocio (negocios.penginexr.com). Las cuentas viven en
 * Cloudflare (D1); aquí se crean y se copia el enlace de acceso para enviarlo por WhatsApp.
 */
export function OwnerAccounts({ business }: { business: BusinessDetail }) {
  const accounts = useResource(() => api.listAccounts(business.id), business.id);
  const { notify, reportError } = useNotices();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<(LoginLink & { email: string }) | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const account = await api.addAccount(business.id, {
        email: String(form.get('email') ?? ''),
        name: emptyToNull(String(form.get('name') ?? '')),
      });
      formElement.reset();
      notify('success', `${account.email} ya puede entrar al portal.`);
      accounts.reload();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function createLink(account: Account) {
    setBusy(true);
    try {
      setLink({ ...(await api.loginLink(business.id, account.id)), email: account.email });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(account: Account) {
    if (!confirm(`¿Quitar el acceso de ${account.email} a ${business.name}?`)) return;
    setBusy(true);
    try {
      await api.removeAccount(business.id, account.id);
      if (link?.email === account.email) setLink(null);
      notify('success', 'Acceso quitado.');
      accounts.reload();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  const whatsappText = link
    ? `Hola, con este enlace entras al portal de ${business.name} (sirve una sola vez y caduca en 24 horas): ${link.url}`
    : '';

  return (
    <section>
      <h2>Acceso del dueño al portal</h2>
      <div className="card">
        <p className="muted small">
          El dueño entra a negocios.penginexr.com con su correo: cambia el destino y la etiqueta de
          sus chips, las visitas del premio y ve sus estadísticas. No puede asignar ni liberar
          chips.
        </p>

        {accounts.error ? (
          <LoadError error={accounts.error} retry={accounts.reload} />
        ) : !accounts.data ? (
          <Loading />
        ) : accounts.data.accounts.length === 0 ? (
          <p className="muted">Nadie tiene acceso todavía.</p>
        ) : (
          <ul className="list">
            {accounts.data.accounts.map((account) => (
              <li key={account.id} className="list-item">
                <span className="truncate">
                  {account.name ? `${account.name} · ` : ''}
                  {account.email}
                  <span className="muted small">
                    {' '}
                    ·{' '}
                    {account.lastLoginAt
                      ? `último acceso ${formatDate(account.lastLoginAt)}`
                      : 'nunca entró'}
                  </span>
                </span>
                <div className="actions">
                  <button
                    type="button"
                    className="button button-small"
                    disabled={busy}
                    onClick={() => void createLink(account)}
                  >
                    Enlace de acceso
                  </button>
                  <button
                    type="button"
                    className="button button-small button-danger"
                    disabled={busy}
                    onClick={() => void remove(account)}
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {link && (
          <div className="card card-info">
            <p className="small">
              Enlace para <strong>{link.email}</strong>: sirve una sola vez y caduca el{' '}
              {formatDate(link.expiresAt)}: envíaselo solo a esa persona.
            </p>
            <div className="url-box">
              <code className="truncate">{link.url}</code>
              <CopyButton text={link.url} />
            </div>
            <div className="actions actions-start">
              <a
                className="button button-small"
                href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                target="_blank"
                rel="noreferrer"
              >
                Enviar por WhatsApp
              </a>
            </div>
          </div>
        )}

        <form className="form-inline" onSubmit={add}>
          <label className="grow">
            Correo
            <input className="input" type="email" name="email" required maxLength={254} />
          </label>
          <label>
            Nombre (opcional)
            <input className="input" name="name" maxLength={120} />
          </label>
          <button type="submit" className="button button-primary" disabled={busy}>
            Dar acceso
          </button>
        </form>
      </div>
    </section>
  );
}
