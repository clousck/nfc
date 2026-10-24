import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type Business } from '../api';
import { useResource } from '../hooks';
import { RateLimitIncidents } from '../components/RateLimitIncidents';
import { useNotices } from '../notices';
import { BusinessStatusBadge, emptyToNull, LoadError, Loading, PLAN_LABELS } from '../ui';

export function BusinessesPage() {
  const businesses = useResource(api.listBusinesses, 'businesses');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const term = search.trim().toLowerCase();
  const visible = (businesses.data ?? []).filter(
    (b) =>
      term === '' ||
      b.name.toLowerCase().includes(term) ||
      (b.contactName ?? '').toLowerCase().includes(term) ||
      (b.phone ?? '').includes(term),
  );

  return (
    <>
      <div className="page-title">
        <h1>Negocios</h1>
        {!creating && (
          <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
            + Nuevo negocio
          </button>
        )}
      </div>

      {creating && <NewBusinessForm onCancel={() => setCreating(false)} />}

      {businesses.error && <LoadError error={businesses.error} retry={businesses.reload} />}
      {businesses.loading && !businesses.data && <Loading />}

      {businesses.data && businesses.data.length > 0 && (
        <input
          className="input search"
          type="search"
          placeholder="Buscar por nombre, contacto o teléfono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {businesses.data && businesses.data.length === 0 && !creating && (
        <div className="card empty">
          <p>Todavía no hay negocios.</p>
          <p className="muted">Crea el primero para asignarle un chip.</p>
        </div>
      )}

      <ul className="list">
        {visible.map((b) => (
          <BusinessRow key={b.id} business={b} />
        ))}
      </ul>

      <RateLimitIncidents />
    </>
  );
}

function BusinessRow({ business }: { business: Business }) {
  return (
    <li>
      <Link to={`/negocios/${business.id}`} className="list-item">
        <div>
          <strong>{business.name}</strong>
          <div className="muted small">
            {[business.contactName, business.phone].filter(Boolean).join(' · ') || 'Sin contacto'}
          </div>
        </div>
        <div className="badges">
          <span className="small muted">{PLAN_LABELS[business.plan]}</span>
          <BusinessStatusBadge status={business.status} />
        </div>
      </Link>
    </li>
  );
}

function NewBusinessForm({ onCancel }: { onCancel: () => void }) {
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
    <form className="card form" onSubmit={submit}>
      <h2>Nuevo negocio</h2>
      <label>
        Nombre *
        <input className="input" name="name" required maxLength={120} autoFocus />
      </label>
      <div className="row">
        <label>
          Contacto
          <input className="input" name="contactName" maxLength={120} />
        </label>
        <label>
          Teléfono
          <input className="input" name="phone" type="tel" maxLength={40} />
        </label>
      </div>
      <label>
        Plan
        <select className="input" name="plan" defaultValue="basic">
          <option value="basic">Básico</option>
          <option value="premium">Premium</option>
        </select>
      </label>
      <div className="actions">
        <button type="button" className="button" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? 'Creando…' : 'Crear negocio'}
        </button>
      </div>
    </form>
  );
}
