import { Link } from 'react-router';
import { api, type Business, type TagView } from '../api';
import { TAG_STATE_LABEL, tagState, type TagState } from '../chips';
import { useResource } from '../hooks';
import { BusinessStatusBadge, LoadError, Loading, PageHead } from '../ui';

const RACK_LEGEND: TagState[] = ['live', 'locked', 'free', 'paused', 'off'];

/** Inicio: ¿funciona todo y qué necesita atención? (docs/UI.md §4). */
export function HomePage() {
  const businesses = useResource(api.listBusinesses, 'businesses');
  const tags = useResource(() => api.listTags(), 'all-tags');
  const status = useResource(api.syncStatus, 'sync-status:home');
  const incidents = useResource(() => api.getIncidents(), 'incidents:*');

  if (businesses.error) return <LoadError error={businesses.error} retry={businesses.reload} />;
  if (tags.error) return <LoadError error={tags.error} retry={tags.reload} />;
  if (!businesses.data || !tags.data) return <Loading />;

  const all = businesses.data;
  const chips = [...tags.data].sort((a, b) => a.number - b.number);
  const names = new Map(all.map((b) => [b.id, b.name]));
  const active = all.filter((b) => b.status === 'active').length;
  const paused = all.filter((b) => b.status === 'paused').length;
  const used = chips.filter((t) => t.businessId).length;
  const pending = status.data?.pending ?? 0;
  const attention = attentionItems(chips, all, names, pending);
  const incidentCount = incidents.data?.incidents.length ?? 0;

  return (
    <>
      <PageHead
        title="Inicio"
        sub={
          attention.length === 0
            ? `Todo en orden · ${active} ${active === 1 ? 'negocio activo' : 'negocios activos'} · ${chipLabel(used)} en la calle`
            : `${attention.length} ${attention.length === 1 ? 'cosa necesita' : 'cosas necesitan'} atención · ${chipLabel(used)} en la calle`
        }
        actions={
          <Link className="button button-primary" to="/negocios?nuevo=1">
            Nuevo negocio
          </Link>
        }
      />

      <dl className="kpis">
        <div>
          <dt>Negocios activos</dt>
          <dd>
            {active}
            <small>de {all.length}</small>
          </dd>
          <p>{paused > 0 ? `${paused} pausado${paused === 1 ? '' : 's'}` : 'ninguno pausado'}</p>
        </div>
        <div>
          <dt>Chips en uso</dt>
          <dd>
            {used}
            <small>de {chips.length}</small>
          </dd>
          <p>{chips.length - used} libres en el inventario</p>
        </div>
        <div>
          <dt>Cambios por publicar</dt>
          <dd>{status.data ? pending : '—'}</dd>
          <p>{pending > 0 ? 'se reintentan solos' : 'Cloudflare al día'}</p>
        </div>
        <div>
          <dt>Límites superados</dt>
          <dd>{incidents.data ? incidentCount : '—'}</dd>
          <p>
            {incidents.data
              ? `${incidents.data.days} días · ${incidents.data.mode === 'observe' ? 'solo observación' : 'bloqueando'}`
              : 'cargando…'}
          </p>
        </div>
      </dl>

      <div className="layout home-layout">
        <div>
          <section>
            <div className="section-title">
              <h2>Rack de chips</h2>
              <Link to="/chips" className="small">
                Ver la lista
              </Link>
            </div>
            <div className="card">
              {chips.length === 0 ? (
                <p className="muted">
                  Todavía no hay chips. <Link to="/chips">Crea los primeros</Link>.
                </p>
              ) : (
                <div className="rack">
                  {chips.map((tag) => {
                    const state = tagState(tag);
                    const owner = tag.businessId ? names.get(tag.businessId) : null;
                    const title = `#${tag.number}${tag.label ? ` · ${tag.label}` : ''} · ${owner ?? 'Libre'} · ${TAG_STATE_LABEL[state]}`;
                    return (
                      <Link
                        key={tag.slug}
                        to={`/chips/${tag.slug}`}
                        className={`is-${state === 'missing' ? 'paused' : state}`}
                        title={title}
                        aria-label={title}
                      >
                        {tag.number}
                      </Link>
                    );
                  })}
                </div>
              )}
              <div className="rack-legend">
                {RACK_LEGEND.map((state) => (
                  <span key={state}>
                    <i className={`is-${state}`} />
                    {state === 'paused' ? 'Pausado o sin destino' : TAG_STATE_LABEL[state]}{' '}
                    <strong className="num">
                      {
                        chips.filter((t) => {
                          const s = tagState(t);
                          return state === 'paused'
                            ? s === 'paused' || s === 'missing'
                            : s === state;
                        }).length
                      }
                    </strong>
                  </span>
                ))}
              </div>
            </div>
          </section>
          <section>
            <div className="section-title">
              <h2>Negocios recientes</h2>
              <Link to="/negocios" className="small">
                Ver todos
              </Link>
            </div>
            {all.length === 0 ? (
              <div className="empty">Todavía no hay negocios.</div>
            ) : (
              <ul className="list">
                {[...all]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .slice(0, 5)
                  .map((b) => (
                    <li key={b.id}>
                      <Link to={`/negocios/${b.id}`} className="list-item">
                        <span className="truncate">
                          <strong>{b.name}</strong>
                          <span className="small muted">
                            {' '}
                            · {chipLabel(chips.filter((t) => t.businessId === b.id).length)}
                          </span>
                        </span>
                        <BusinessStatusBadge status={b.status} />
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
        <div>
          <section>
            <h2>Requiere atención</h2>
            {attention.length === 0 ? (
              <div className="empty">Nada pendiente: todos los chips asignados funcionan.</div>
            ) : (
              <ul className="list attention">
                {attention.map((item) => (
                  <li key={item.key}>
                    <Link to={item.to}>{item.title}</Link>
                    <span className={`badge badge-${item.tone}`}>{item.badge}</span>
                    <span className="small muted">{item.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

const chipLabel = (count: number) => `${count} ${count === 1 ? 'chip' : 'chips'}`;

interface AttentionItem {
  key: string;
  to: string;
  title: string;
  badge: string;
  tone: 'warn' | 'bad' | 'info';
  detail: string;
}

/** Lo que pide una acción del proveedor, lo más urgente primero. */
function attentionItems(
  chips: TagView[],
  businesses: Business[],
  names: Map<string, string>,
  pending: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const tag of chips.filter((t) => t.pausedAt)) {
    items.push({
      key: `paused-${tag.slug}`,
      to: `/chips/${tag.slug}`,
      title: `Chip #${tag.number}${tag.label ? ` · ${tag.label}` : ''}`,
      badge: 'Stand perdido',
      tone: 'bad',
      detail: `${names.get(tag.businessId ?? '') ?? 'Negocio'} lo pausó: visita el local o repón el stand.`,
    });
  }
  for (const tag of chips.filter((t) => t.businessId && !t.pausedAt && !t.published)) {
    items.push({
      key: `missing-${tag.slug}`,
      to: `/chips/${tag.slug}`,
      title: `Chip #${tag.number}${tag.label ? ` · ${tag.label}` : ''}`,
      badge: 'Sin destino',
      tone: 'warn',
      detail: `De ${names.get(tag.businessId ?? '') ?? 'un negocio'}: todavía no redirige a ningún lado.`,
    });
  }
  for (const b of businesses.filter((x) => x.status === 'paused')) {
    items.push({
      key: `biz-${b.id}`,
      to: `/negocios/${b.id}`,
      title: b.name,
      badge: 'Pausado',
      tone: 'warn',
      detail: 'Sus chips muestran la página genérica hasta que lo reactives.',
    });
  }
  if (pending > 0) {
    items.push({
      key: 'publish',
      to: '/ajustes',
      title: `${pending} ${pending === 1 ? 'cambio' : 'cambios'} sin publicar`,
      badge: 'Cloudflare',
      tone: 'info',
      detail: 'Se reintentan solos; si no bajan, revisa la conexión con el Worker.',
    });
  }
  return items;
}
