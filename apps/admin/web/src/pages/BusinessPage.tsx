import { useState, type FormEvent } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { api, type BusinessDetail } from '../api';
import { host, TAG_STATE_LABEL, TAG_STATE_TONE, tagState } from '../chips';
import { LoyaltyProgram } from '../components/LoyaltyProgram';
import { OwnerAccounts } from '../components/OwnerAccounts';
import { RateLimitIncidents } from '../components/RateLimitIncidents';
import { ReportLink } from '../components/ReportLink';
import { StaffDevices } from '../components/StaffDevices';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import {
  BusinessStatusBadge,
  ChipModeField,
  Drawer,
  emptyToNull,
  formatDate,
  LoadError,
  Loading,
  PageHead,
  PLAN_LABELS,
  STATUS_LABELS,
  type ChipMode,
} from '../ui';

const TABS = [
  { key: '', label: 'Resumen' },
  { key: 'fidelidad', label: 'Fidelidad' },
  { key: 'accesos', label: 'Accesos' },
  { key: 'estadisticas', label: 'Estadísticas' },
  { key: 'datos', label: 'Datos' },
] as const;

export function BusinessPage() {
  const { id = '', tab = '' } = useParams();
  const business = useResource(() => api.getBusiness(id), `business:${id}`);
  const [adding, setAdding] = useState(false);

  if (business.error) return <LoadError error={business.error} retry={business.reload} />;
  if (!business.data) return <Loading />;
  const data = business.data;
  const loyalty = data.loyaltyVisits !== null;

  return (
    <>
      <PageHead
        crumbs={<Link to="/negocios">Negocios</Link>}
        title={data.name}
        badges={<BusinessStatusBadge status={data.status} />}
        sub={`${PLAN_LABELS[data.plan]} · ${data.tags.length} ${data.tags.length === 1 ? 'chip' : 'chips'} · ${
          loyalty ? `fidelidad a las ${data.loyaltyVisits} visitas` : 'sin fidelidad'
        }`}
        actions={
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            Añadir chip
          </button>
        }
      />

      <nav className="tabs" aria-label="Secciones del negocio">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/negocios/${data.id}${t.key ? `/${t.key}` : ''}`}
            end
            className={({ isActive }) => `tab${isActive ? ' tab-active' : ''}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      {tab === '' && <Summary business={data} onAdd={() => setAdding(true)} />}
      {tab === 'fidelidad' && <LoyaltyProgram business={data} onChanged={business.reload} />}
      {tab === 'accesos' && (
        <div className="grid-2">
          <OwnerAccounts business={data} />
          {loyalty ? (
            <StaffDevices business={data} />
          ) : (
            <section>
              <h2>Móviles del personal</h2>
              <div className="empty">
                Se usan para validar los premios: actívalos con el programa de fidelidad.
              </div>
            </section>
          )}
        </div>
      )}
      {tab === 'estadisticas' && (
        <div className="layout layout-rail-first">
          <RateLimitIncidents businessId={data.id} />
          <ReportLink business={data} onChanged={business.reload} />
        </div>
      )}
      {tab === 'datos' && (
        <>
          <BusinessForm key={JSON.stringify(data)} business={data} onSaved={business.reload} />
          <DeleteBusiness business={data} />
        </>
      )}

      {adding && (
        <AddTagDrawer
          businessId={data.id}
          onClose={() => setAdding(false)}
          onAdded={business.reload}
        />
      )}
    </>
  );
}

function Summary({ business, onAdd }: { business: BusinessDetail; onAdd: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="layout">
      <section>
        <h2>Chips</h2>
        {business.tags.length === 0 ? (
          <div className="empty">
            Este negocio todavía no tiene chips.{' '}
            <button type="button" className="button button-small" onClick={onAdd}>
              Añadir el primero
            </button>
          </div>
        ) : (
          <div className="table-frame table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Chip</th>
                  <th className="hide-sm">Modo</th>
                  <th>Destino</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {business.tags.map((tag) => {
                  const state = tagState(tag);
                  return (
                    <tr key={tag.slug} onClick={() => navigate(`/chips/${tag.slug}`)}>
                      <td className="ident">
                        <strong>
                          <Link to={`/chips/${tag.slug}`} onClick={(e) => e.stopPropagation()}>
                            <span className="chip-no">#{tag.number}</span>
                            {tag.label ? ` ${tag.label}` : ''}
                          </Link>
                        </strong>
                        <span className="chip-code">{tag.slug}</span>
                      </td>
                      <td className="hide-sm">
                        {tag.type === 'loyalty' ? 'Tarjeta de sellos' : 'Redirección'}
                      </td>
                      <td className="truncate">
                        {host(tag.targetUrl) || <span className="muted">—</span>}
                      </td>
                      <td>
                        <span className={`badge badge-${TAG_STATE_TONE[state]}`}>
                          {TAG_STATE_LABEL[state]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <div className="section-title">
          <h2>Ficha</h2>
          <Link to={`/negocios/${business.id}/datos`} className="small">
            Editar
          </Link>
        </div>
        <dl className="card facts">
          <div>
            <dt>Contacto</dt>
            <dd>{business.contactName ?? '—'}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{business.phone ?? '—'}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{PLAN_LABELS[business.plan]}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{STATUS_LABELS[business.status]}</dd>
          </div>
          <div>
            <dt>Alta</dt>
            <dd>{formatDate(business.createdAt)}</dd>
          </div>
          {business.notes && (
            <div className="facts-notes">
              <dt>Notas</dt>
              <dd>{business.notes}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}

function AddTagDrawer({
  businessId,
  onClose,
  onAdded,
}: {
  businessId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const navigate = useNavigate();
  const { reportSync, reportError } = useNotices();
  const free = useResource(() => api.listTags({ unassigned: true }), 'free-tags');
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ChipMode>('redirect');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const source = String(form.get('source') ?? 'new');
    const input = {
      businessId,
      type: mode,
      label: emptyToNull(String(form.get('label') ?? '')),
      targetUrl: emptyToNull(String(form.get('targetUrl') ?? '')),
    };
    setSaving(true);
    try {
      const tag =
        source === 'new' ? await api.createTag(input) : await api.updateTag(source, input);
      reportSync(tag.sync, `Chip #${tag.number} asignado.`);
      onAdded();
      navigate(`/chips/${tag.slug}`);
    } catch (err) {
      reportError(err);
      setSaving(false);
    }
  }

  const freeTags = free.data ?? [];
  return (
    <Drawer
      title="Añadir chip"
      sub="Toma uno libre del inventario o crea uno nuevo."
      onClose={onClose}
    >
      <form className="form" onSubmit={submit}>
        <label>
          Chip
          <select className="input" name="source" defaultValue="new">
            <option value="new">Crear uno nuevo</option>
            {freeTags.map((t) => (
              <option key={t.slug} value={t.slug}>
                Del inventario: #{t.number} · {t.slug}
                {t.label ? ` (${t.label})` : ''}
                {t.lockedAt ? ' · ya grabado' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Etiqueta
          <input
            className="input"
            name="label"
            placeholder="Caja principal, Mesa 3…"
            maxLength={80}
          />
        </label>
        <ChipModeField value={mode} onChange={setMode} />
        <label>
          {mode === 'loyalty' ? 'Destino después de la tarjeta (opcional)' : 'Destino'}
          <input
            className="input"
            name="targetUrl"
            type="url"
            placeholder="https://g.page/r/…/review"
            required={mode === 'redirect'}
          />
          <span className="hint">
            Adonde lleva el chip: reseñas de Google, WhatsApp (https://wa.me/593…), Instagram, menú…
          </span>
        </label>
        <div className="actions">
          <button type="button" className="button" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Añadir'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

function BusinessForm({ business, onSaved }: { business: BusinessDetail; onSaved: () => void }) {
  const { reportSync, reportError } = useNotices();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = String(form.get('status'));
    setSaving(true);
    try {
      const result = await api.updateBusiness(business.id, {
        name: String(form.get('name') ?? '').trim(),
        contactName: emptyToNull(String(form.get('contactName') ?? '')),
        phone: emptyToNull(String(form.get('phone') ?? '')),
        plan: form.get('plan') === 'premium' ? 'premium' : 'basic',
        status: status === 'paused' || status === 'cancelled' ? status : 'active',
        notes: emptyToNull(String(form.get('notes') ?? '')),
      });
      reportSync(result.sync, 'Negocio guardado.');
      onSaved();
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="setting">
      <div className="setting-label">
        <h2>Datos del negocio</h2>
        <p>Pausado o cancelado: sus chips muestran la página genérica.</p>
        <p>Alta: {formatDate(business.createdAt)}</p>
      </div>
      <form className="card form" onSubmit={submit}>
        <label>
          Nombre
          <input
            className="input"
            name="name"
            defaultValue={business.name}
            required
            maxLength={120}
          />
        </label>
        <div className="row">
          <label>
            Contacto
            <input className="input" name="contactName" defaultValue={business.contactName ?? ''} />
          </label>
          <label>
            Teléfono
            <input className="input" name="phone" type="tel" defaultValue={business.phone ?? ''} />
          </label>
        </div>
        <div className="row">
          <label>
            Plan
            <select className="input" name="plan" defaultValue={business.plan}>
              <option value="basic">Básico</option>
              <option value="premium">Premium</option>
            </select>
          </label>
          <label>
            Estado
            <select className="input" name="status" defaultValue={business.status}>
              <option value="active">Activo</option>
              <option value="paused">Pausado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </label>
        </div>
        <label>
          Notas
          <textarea className="input" name="notes" rows={3} defaultValue={business.notes ?? ''} />
        </label>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteBusiness({ business }: { business: BusinessDetail }) {
  const navigate = useNavigate();
  const { notify, reportError } = useNotices();

  async function remove() {
    if (!confirm(`¿Borrar "${business.name}"? No se puede deshacer.`)) return;
    try {
      await api.deleteBusiness(business.id);
      notify('success', 'Negocio borrado.');
      navigate('/negocios');
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div className="setting">
      <div className="setting-label">
        <h2>Borrar negocio</h2>
        <p>No se puede deshacer.</p>
      </div>
      <div className="card">
        {business.tags.length > 0 ? (
          <p className="muted">
            Para borrar este negocio primero libera sus chips, o márcalo como cancelado.
          </p>
        ) : (
          <button type="button" className="button button-danger" onClick={() => void remove()}>
            Borrar «{business.name}»
          </button>
        )}
      </div>
    </div>
  );
}
