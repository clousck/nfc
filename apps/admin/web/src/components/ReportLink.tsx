import { useState } from 'react';
import { api, type BusinessDetail } from '../api';
import { useNotices } from '../notices';
import { CopyButton } from '../ui';

/** Enlace privado de estadísticas que se le comparte al negocio. */
export function ReportLink({
  business,
  onChanged,
}: {
  business: BusinessDetail;
  onChanged: () => void;
}) {
  const { reportSync, reportError } = useNotices();
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    if (
      business.reportUrl &&
      !confirm(
        'Se creará un enlace nuevo y el actual dejará de funcionar. Tendrás que enviarle el nuevo al negocio. ¿Continuar?',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.regenerateReport(business.id);
      reportSync(result.sync, business.reportUrl ? 'Enlace nuevo creado.' : 'Enlace creado.');
      onChanged();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  const whatsappText = business.reportUrl
    ? `Hola, aquí puedes ver cuántas personas usan tus chips y códigos QR: ${business.reportUrl}`
    : '';

  return (
    <section>
      <h2>Estadísticas para el negocio</h2>
      <div className="card">
        {business.status === 'cancelled' ? (
          <p className="muted">El negocio está cancelado: su enlace de estadísticas no funciona.</p>
        ) : business.reportUrl ? (
          <>
            <p className="muted small report-hint">
              Envíale este enlace al negocio. Lo abre sin usuario ni contraseña y ve sus escaneos al
              día. No lo publiques en redes.
            </p>
            <div className="url-box">
              <code className="truncate">{business.reportUrl}</code>
              <CopyButton text={business.reportUrl} />
            </div>
            <div className="actions actions-start">
              <a
                className="button button-small"
                href={business.reportUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir
              </a>
              <a
                className="button button-small"
                href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                target="_blank"
                rel="noreferrer"
              >
                Enviar por WhatsApp
              </a>
              <button
                type="button"
                className="button button-small"
                onClick={regenerate}
                disabled={busy}
              >
                Generar enlace nuevo
              </button>
            </div>
          </>
        ) : (
          <div className="actions actions-start">
            <p className="muted small">Este negocio todavía no tiene enlace de estadísticas.</p>
            <button
              type="button"
              className="button button-primary"
              onClick={regenerate}
              disabled={busy}
            >
              Crear enlace
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
