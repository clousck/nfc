import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type BusinessDetail, type Tag } from '../api';
import { LoyaltyProgram } from '../components/LoyaltyProgram';
import { OwnerAccounts } from '../components/OwnerAccounts';
import { RateLimitIncidents } from '../components/RateLimitIncidents';
import { StaffDevices } from '../components/StaffDevices';
import { ReportLink } from '../components/ReportLink';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import {
  emptyToNull,
  LoadError,
  Loading,
  TagBadges,
  BusinessStatusBadge,
  formatDate,
  ChipModeField,
  type ChipMode,
} from '../ui';

export function BusinessPage() {
  const { id = '' } = useParams();
  const business = useResource(() => api.getBusiness(id), `business:${id}`);

  if (business.error) return <LoadError error={business.error} retry={business.reload} />;
  if (!business.data) return <Loading />;
  const data = business.data;

  return (
    <>
      <p className="breadcrumb">
        <Link to="/">← Negocios</Link>
      </p>
      <div className="page-title">
        <h1>{data.name}</h1>
        <BusinessStatusBadge status={data.status} />
      </div>

      <section>
        <h2>Chips ({data.tags.length})</h2>
        {data.tags.length === 0 ? (
          <p className="muted">Este negocio todavía no tiene chips.</p>
        ) : (
          <ul className="list">
            {data.tags.map((tag) => (
              <TagRow key={tag.slug} tag={tag} />
            ))}
          </ul>
        )}
        <AddTagForm businessId={data.id} onAdded={business.reload} />
      </section>

      <LoyaltyProgram business={data} onChanged={business.reload} />

      <OwnerAccounts business={data} />

      {data.loyaltyVisits !== null && <StaffDevices business={data} />}

      <ReportLink business={data} onChanged={business.reload} />

      <RateLimitIncidents businessId={data.id} />

      <BusinessForm key={JSON.stringify(data)} business={data} onSaved={business.reload} />
      <DeleteBusiness business={data} />
    </>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  return (
    <li>
      <Link to={`/chips/${tag.slug}`} className="list-item">
        <div className="truncate">
          <strong>#{tag.number}</strong> <code className="chip-code">{tag.slug}</code>
          {tag.label && <span className="muted"> · {tag.label}</span>}
          <div className="muted small truncate">
            {tag.type === 'loyalty'
              ? `Tarjeta de sellos${tag.targetUrl ? ` → ${tag.targetUrl}` : ''}`
              : (tag.targetUrl ?? 'Sin destino')}
          </div>
        </div>
        <div className="badges">
          <TagBadges tag={tag} />
        </div>
      </Link>
    </li>
  );
}

function AddTagForm({ businessId, onAdded }: { businessId: string; onAdded: () => void }) {
  const navigate = useNavigate();
  const { reportSync, reportError } = useNotices();
  const free = useResource(() => api.listTags({ unassigned: true }), 'free-tags');
  const [open, setOpen] = useState(false);
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

  if (!open) {
    return (
      <button type="button" className="button button-primary" onClick={() => setOpen(true)}>
        + Añadir chip
      </button>
    );
  }

  const freeTags = free.data ?? [];
  return (
    <form className="card form" onSubmit={submit}>
      <h3>Añadir chip</h3>
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
        <button type="button" className="button" onClick={() => setOpen(false)} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving ? 'Guardando…' : 'Añadir'}
        </button>
      </div>
    </form>
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
    <section>
      <h2>Datos del negocio</h2>
      <form className="card form" onSubmit={submit}>
        <label>
          Nombre *
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
            <span className="hint">
              Pausado o cancelado: sus chips muestran la página genérica.
            </span>
          </label>
        </div>
        <label>
          Notas
          <textarea className="input" name="notes" rows={3} defaultValue={business.notes ?? ''} />
        </label>
        <p className="muted small">Creado: {formatDate(business.createdAt)}</p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </section>
  );
}

function DeleteBusiness({ business }: { business: BusinessDetail }) {
  const navigate = useNavigate();
  const { notify, reportError } = useNotices();

  if (business.tags.length > 0) {
    return (
      <p className="muted small">
        Para borrar este negocio primero libera sus chips, o márcalo como cancelado.
      </p>
    );
  }

  async function remove() {
    if (!confirm(`¿Borrar "${business.name}"? No se puede deshacer.`)) return;
    try {
      await api.deleteBusiness(business.id);
      notify('success', 'Negocio borrado.');
      navigate('/');
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <button type="button" className="button button-danger" onClick={remove}>
      Borrar negocio
    </button>
  );
}
