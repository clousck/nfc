import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import { CopyButton, emptyToNull, LoadError, Loading, TagBadges } from '../ui';

const MAX_BATCH = 50;

export function InventoryPage() {
  const tags = useResource(() => api.listTags({ unassigned: true }), 'free-tags');

  return (
    <>
      <div className="page-title">
        <h1>Chips libres</h1>
      </div>
      <p className="muted">
        Chips creados que todavía no pertenecen a ningún negocio. Puedes grabarlos por adelantado y
        asignarlos después.
      </p>

      <CreateBatchForm onCreated={tags.reload} />

      {tags.error && <LoadError error={tags.error} retry={tags.reload} />}
      {tags.loading && !tags.data && <Loading />}
      {tags.data && tags.data.length === 0 && (
        <div className="card empty">
          <p>No hay chips libres.</p>
        </div>
      )}

      <ul className="list">
        {(tags.data ?? []).map((tag) => (
          <li key={tag.slug} className="list-item">
            <Link to={`/chips/${tag.slug}`} className="truncate">
              <strong>#{tag.number}</strong>{' '}
              {tag.label && <span className="muted">{tag.label}</span>}
            </Link>
            <div className="badges">
              <TagBadges tag={tag} />
              <CopyButton text={tag.urls.nfc} label="Copiar URL" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function CreateBatchForm({ onCreated }: { onCreated: () => void }) {
  const { notify, reportError } = useNotices();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const count = Math.min(MAX_BATCH, Math.max(1, Number(form.get('count')) || 1));
    const label = emptyToNull(String(form.get('label') ?? ''));
    setSaving(true);
    let created = 0;
    try {
      for (let i = 0; i < count; i++) {
        await api.createTag({ label });
        created++;
      }
      notify('success', `${created} chip(s) creados.`);
    } catch (err) {
      reportError(err);
      if (created > 0) notify('warning', `Solo se crearon ${created} de ${count}.`);
    } finally {
      setSaving(false);
      onCreated();
    }
  }

  return (
    <form className="card form form-inline" onSubmit={submit}>
      <label>
        Cantidad
        <input
          className="input"
          name="count"
          type="number"
          min={1}
          max={MAX_BATCH}
          defaultValue={1}
        />
      </label>
      <label className="grow">
        Etiqueta (opcional)
        <input className="input" name="label" placeholder="Lote octubre" maxLength={80} />
      </label>
      <button type="submit" className="button button-primary" disabled={saving}>
        {saving ? 'Creando…' : 'Crear chips'}
      </button>
    </form>
  );
}
