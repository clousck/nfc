import { api } from '../api';
import { useResource } from '../hooks';
import { formatDate } from '../ui';

const ACTIONS: Record<string, string> = {
  signup: 'Alta de tarjeta',
  checkin: 'QR del local',
  redeem: 'Canje de premio',
  validate: 'Validación de canje',
  login: 'Pedir acceso al portal',
};

const ACTORS: Record<string, string> = {
  customer: 'Cliente',
  staff: 'Personal',
  anonymous: 'Sin credencial',
};

const SCOPES: Record<string, string> = {
  device: 'por móvil',
  network: 'por red',
  staff: 'del personal',
  login: 'por correo',
};

/**
 * Veces que se superó un límite de peticiones (últimos 30 días). En modo observación
 * nadie fue bloqueado: sirve para ajustar los límites antes de activarlos.
 */
export function RateLimitIncidents({ businessId }: { businessId?: string }) {
  const incidents = useResource(
    () => (businessId ? api.getBusinessIncidents(businessId) : api.getIncidents()),
    `incidents:${businessId ?? '*'}`,
  );
  const data = incidents.data;

  return (
    <section>
      <div className="section-title">
        <h2>Límites de peticiones</h2>
        <button
          type="button"
          className="button button-small"
          onClick={incidents.reload}
          disabled={incidents.loading}
        >
          {incidents.loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {incidents.error && <div className="card card-warning">{incidents.error.message}</div>}

      {data && (
        <div className="card">
          <p className="muted small">
            {data.mode === 'observe'
              ? 'Modo observación: se registra cuándo se habría bloqueado, pero no se bloquea a nadie.'
              : 'Modo bloqueo: al superar el límite se responde "Demasiados intentos".'}{' '}
            Un solo origen insistiendo suele ser un script; muchos orígenes a la vez, que el límite
            es bajo para la hora punta.
          </p>
          {data.incidents.length === 0 ? (
            <p className="muted">Sin incidentes en los últimos {data.days} días.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Día</th>
                    {businessId ? null : <th>Negocio</th>}
                    <th>Acción</th>
                    <th>Quién</th>
                    <th>Minutos</th>
                    <th>Orígenes</th>
                    <th>Último</th>
                  </tr>
                </thead>
                <tbody>
                  {data.incidents.map((i) => (
                    <tr
                      key={`${i.businessId}-${i.day}-${i.action}-${i.actor}-${i.scope}-${i.mode}`}
                    >
                      <td>{i.day}</td>
                      {businessId ? null : <td>{i.businessName ?? '—'}</td>}
                      <td>{ACTIONS[i.action] ?? i.action}</td>
                      <td>
                        {ACTORS[i.actor] ?? i.actor}{' '}
                        <span className="muted small">(límite {SCOPES[i.scope] ?? i.scope})</span>
                      </td>
                      <td>{i.minutes}</td>
                      <td>{i.sources}</td>
                      <td>{formatDate(i.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
