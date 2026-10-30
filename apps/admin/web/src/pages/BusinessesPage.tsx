import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, type Business } from '../api';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import {
  BusinessStatusBadge,
  Drawer,
  emptyToNull,
  LoadError,
  Loading,
  PageHead,
  PLAN_LABELS,
} from '../ui';

type Filter = 'todos' | Business['status'];

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'paused', label: 'Pausados' },
  { value: 'cancelled', label: 'Cancelados' },
];

const shortDate = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium' });

export function BusinessesPage() {
  const navigate = useNavigate();
  const businesses = useResource(api.listBusinesses, 'businesses');
  const tags = useResource(() => api.listTags(), 'all-tags');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const filter = (FILTERS.find((f) => f.value === params.get('estado'))?.value ??
    'todos') as Filter;
  const creating = params.get('nuevo') === '1';

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const all = businesses.data ?? [];
  const chipCount = new Map<string, number>();
  for (const t of tags.data ?? []) {
    if (t.businessId) chipCount.set(t.businessId, (chipCount.get(t.businessId) ?? 0) + 1);
  }
  const term = search.trim().toLowerCase();
  const matches = all.filter(
    (b) =>
      term === '' ||
      b.name.toLowerCase().includes(term) ||
      (b.contactName ?? '').toLowerCase().includes(term) ||
      (b.phone ?? '').includes(term),
  );
  const count = (f: Filter) =>
    f === 'todos' ? matches.length : matches.filter((b) => b.status === f).length;
  const visible = matches.filter((b) => filter === 'todos' || b.status === filter);

  return (
    <>
      <PageHead
        title="Negocios"
        sub="Tus clientes, su plan y sus chips."
        actions={
          <button
            type="button"
            className="button button-primary"
            onClick={() => setParam('nuevo', '1')}
          >
            Nuevo negocio
          </button>
        }
      />

      <div className="tabs" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            className={`tab${filter === f.value ? ' tab-active' : ''}`}
            onClick={() => setParam('estado', f.value === 'todos' ? null : f.value)}
          >
            {f.label}
            <span className="tab-count">{businesses.data ? count(f.value) : '…'}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Buscar por nombre, contacto o teléfono"
          aria-label="Buscar negocios"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="small muted">
          {visible.length} {visible.length === 1 ? 'negocio' : 'negocios'}
        </span>
      </div>

      {businesses.error && <LoadError error={businesses.error} retry={businesses.reload} />}
      {businesses.loading && !businesses.data && <Loading />}

      {businesses.data &&
        (visible.length === 0 ? (
          <div className="empty">
            {all.length === 0
              ? 'Todavía no hay negocios. Crea el primero para asignarle un chip.'
              : 'Ningún negocio coincide con la búsqueda.'}
          </div>
        ) : (
          <div className="table-frame table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Negocio</th>
                  <th className="hide-sm">Plan</th>
                  <th>Estado</th>
                  <th className="num">Chips</th>
                  <th className="hide-sm">Fidelidad</th>
                  <th className="num hide-sm">Alta</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => (
                  <tr key={b.id} onClick={() => navigate(`/negocios/${b.id}`)}>
                    <td className="ident">
                      <strong>
                        <a
                          href={`/negocios/${b.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(`/negocios/${b.id}`);
                          }}
                        >
                          {b.name}
                        </a>
                      </strong>
                      <span>
                        {[b.contactName, b.phone].filter(Boolean).join(' · ') || 'Sin contacto'}
                      </span>
                    </td>
                    <td className="hide-sm">{PLAN_LABELS[b.plan]}</td>
                    <td>
                      <BusinessStatusBadge status={b.status} />
                    </td>
                    <td className="num">{chipCount.get(b.id) ?? 0}</td>
                    <td className="hide-sm">
                      {b.loyaltyVisits === null ? (
                        <span className="muted">—</span>
                      ) : (
                        `${b.loyaltyVisits} visitas`
                      )}
                    </td>
                    <td className="num muted hide-sm">{shortDate.format(new Date(b.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {creating && <NewBusinessDrawer onClose={() => setParam('nuevo', null)} />}
    </>
  );
}

function NewBusinessDrawer({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { notify, reportError } = useNotices();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const created = await api.createBusiness({
        name: String(form.get('name') ?? '').trim(),
        contactName: emptyToNull(String(form.get('contactName') ?? '')),
        phone: emptyToNull(String(form.get('phone') ?? '')),
        plan: form.get('plan') === 'premium' ? 'premium' : 'basic',
      });
      notify('success', `Negocio "${created.name}" creado.`);
      navigate(`/negocios/${created.id}`);
    } catch (err) {
      reportError(err);
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Nuevo negocio"
      sub="Después le asignas chips y, si quieres, el programa de fidelidad."
      onClose={onClose}
    >
      <form className="form" onSubmit={submit}>
        <label>
          Nombre
          <input className="input" name="name" required maxLength={120} autoFocus />
        </label>
        <label>
          Contacto
          <input className="input" name="contactName" maxLength={120} />
        </label>
        <label>
          Teléfono
          <input className="input" name="phone" type="tel" maxLength={40} />
        </label>
        <label>
          Plan
          <select className="input" name="plan" defaultValue="basic">
            <option value="basic">Básico</option>
            <option value="premium">Premium</option>
          </select>
        </label>
        <div className="actions">
          <button type="button" className="button" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Creando…' : 'Crear negocio'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
