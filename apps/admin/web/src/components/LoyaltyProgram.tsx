import { useState, type FormEvent } from 'react';
import { api, type BusinessDetail } from '../api';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import { formatDate } from '../ui';

const MIN_VISITS = 2;
const MAX_VISITS = 20;

/** Programa de fidelidad del negocio: visitas necesarias y tarjetas de sus clientes. */
export function LoyaltyProgram({
  business,
  onChanged,
}: {
  business: BusinessDetail;
  onChanged: () => void;
}) {
  const { reportSync, reportError } = useNotices();
  const [saving, setSaving] = useState(false);
  const enabled = business.loyaltyVisits !== null;
  const loyaltyChips = business.tags.filter((t) => t.type === 'loyalty').length;

  async function save(loyaltyVisits: number | null) {
    setSaving(true);
    try {
      const result = await api.updateBusiness(business.id, { loyaltyVisits });
      reportSync(
        result.sync,
        loyaltyVisits === null ? 'Programa desactivado.' : 'Programa de fidelidad guardado.',
      );
      onChanged();
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const visits = Number(new FormData(event.currentTarget).get('visits'));
    void save(visits);
  }

  return (
    <section>
      <h2>Programa de fidelidad</h2>
      <form className="card form" onSubmit={submit}>
        <p className="muted small loyalty-hint">
          Los clientes suman 1 sello al día acercando el móvil a un chip en modo «Fidelidad». Al
          completar las visitas, canjean el premio que el local anuncia en su cartel.
        </p>
        <div className="form-inline">
          <label>
            Visitas para el premio
            <input
              className="input"
              name="visits"
              type="number"
              min={MIN_VISITS}
              max={MAX_VISITS}
              required
              defaultValue={business.loyaltyVisits ?? 6}
              key={business.loyaltyVisits ?? 'off'}
            />
          </label>
          <button type="submit" className="button button-primary" disabled={saving}>
            {enabled ? 'Guardar' : 'Activar programa'}
          </button>
          {enabled && (
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={() => {
                if (
                  confirm(
                    '¿Desactivar el programa? Los chips de fidelidad irán directo a su destino. Las tarjetas se conservan.',
                  )
                ) {
                  void save(null);
                }
              }}
            >
              Desactivar
            </button>
          )}
        </div>
        {enabled && loyaltyChips === 0 && (
          <p className="hint">
            Ningún chip de este negocio está en modo «Fidelidad». Cámbialo en la configuración del
            chip.
          </p>
        )}
      </form>
      {enabled && <LoyaltyCards businessId={business.id} visits={business.loyaltyVisits!} />}
    </section>
  );
}

function LoyaltyCards({ businessId, visits }: { businessId: string; visits: number }) {
  const { notify, reportError } = useNotices();
  const cards = useResource(() => api.getLoyalty(businessId), `loyalty:${businessId}`);

  async function remove(cardId: number, name: string) {
    if (
      !confirm(
        `¿Borrar la tarjeta de ${name}? Se eliminan su nombre, su teléfono y sus sellos, y su número podrá registrarse de nuevo.`,
      )
    ) {
      return;
    }
    try {
      await api.deleteLoyaltyCard(businessId, cardId);
      notify('success', 'Tarjeta borrada.');
      cards.reload();
    } catch (err) {
      reportError(err);
    }
  }

  if (cards.error) return <div className="card card-warning">{cards.error.message}</div>;
  if (!cards.data) return <p className="muted">Cargando tarjetas…</p>;
  const list = cards.data.cards;
  const withMarketing = list.filter((c) => c.marketing).length;

  return (
    <div className="card">
      <div className="section-title loyalty-head">
        <h3>Tarjetas ({list.length})</h3>
        {withMarketing > 0 && (
          <a
            className="button button-small"
            href={`/api/businesses/${businessId}/loyalty/contacts.csv`}
          >
            Descargar contactos ({withMarketing})
          </a>
        )}
      </div>
      {list.length === 0 ? (
        <p className="muted">Todavía nadie se ha registrado.</p>
      ) : (
        <div className="table-wrap">
          <table className="loyalty-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="num">Sellos</th>
                <th>Última visita</th>
                <th>Promos</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {list.map((card) => (
                <tr key={card.id}>
                  <td>
                    <strong>{card.name}</strong>
                    <div className="muted small">{card.phone}</div>
                  </td>
                  <td className="num">
                    {card.stamps}/{visits}
                    {card.expired && <div className="muted small">caducada</div>}
                    {card.redemptions > 0 && (
                      <div className="muted small">{card.redemptions} canje(s)</div>
                    )}
                  </td>
                  <td className="small">{formatDate(card.lastVisitAt)}</td>
                  <td>{card.marketing ? 'Sí' : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="button button-small button-danger"
                      onClick={() => void remove(card.id, card.name)}
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">
        Los contactos solo incluyen a quienes aceptaron recibir promociones. Entrégaselos al negocio
        por un canal privado.
      </p>
    </div>
  );
}
