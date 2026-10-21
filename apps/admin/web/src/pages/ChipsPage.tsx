import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type Business, type TagView } from '../api';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import { Badge, CopyButton, emptyToNull, LoadError, Loading, TagBadges } from '../ui';

const MAX_BATCH = 50;

type Filter = 'todos' | 'libres' | 'ocupados';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'libres', label: 'Libres' },
  { value: 'ocupados', label: 'Ocupados' },
];

function parseFilter(value: string | null): Filter {
  return value === 'libres' || value === 'ocupados' ? value : 'todos';
}

export function ChipsPage() {
  const tags = useResource(() => api.listTags(), 'all-tags');
  const businesses = useResource(api.listBusinesses, 'businesses');
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get('ver'));
  const [search, setSearch] = useState('');

  const names = new Map((businesses.data ?? []).map((b: Business) => [b.id, b.name]));
  const all = tags.data ?? [];
  const counts: Record<Filter, number> = {
    todos: all.length,
    libres: all.filter((t) => !t.businessId).length,
    ocupados: all.filter((t) => t.businessId).length,
  };

  const term = search.trim().toLowerCase().replace(/^#/, '');
  const visible = all.filter((tag) => {
    if (filter === 'libres' && tag.businessId) return false;
    if (filter === 'ocupados' && !tag.businessId) return false;
    if (term === '') return true;
    const business = tag.businessId ? (names.get(tag.businessId) ?? '') : '';
    return (
      String(tag.number) === term ||
      tag.slug.toLowerCase().includes(term) ||
      (tag.label ?? '').toLowerCase().includes(term) ||
      business.toLowerCase().includes(term)
    );
  });

  return (
    <>
      <div className="page-title">
        <h1>Chips</h1>
      </div>

      <CreateBatchForm onCreated={tags.reload} />

      <div className="tabs" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            className={`tab${filter === f.value ? ' tab-active' : ''}`}
            onClick={() => setParams(f.value === 'todos' ? {} : { ver: f.value })}
          >
            {f.label} <span className="tab-count">{tags.data ? counts[f.value] : '…'}</span>
          </button>
        ))}
      </div>

      {all.length > 0 && (
        <input
          className="input search"
          type="search"
          placeholder="Buscar por número, código, etiqueta o negocio"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {tags.error && <LoadError error={tags.error} retry={tags.reload} />}
      {tags.loading && !tags.data && <Loading />}
      {tags.data && visible.length === 0 && (
        <div className="card empty">
          <p className="muted">
            {term
              ? 'Ningún chip coincide con la búsqueda.'
              : filter === 'libres'
                ? 'No hay chips libres. Crea algunos arriba.'
                : filter === 'ocupados'
                  ? 'Ningún chip está asignado todavía.'
                  : 'Todavía no hay chips.'}
          </p>
        </div>
      )}

      <ul className="list">
        {visible.map((tag) => (
          <ChipRow
            key={tag.slug}
            tag={tag}
            businessName={tag.businessId ? names.get(tag.businessId) : undefined}
          />
        ))}
      </ul>
    </>
  );
}

function ChipRow({ tag, businessName }: { tag: TagView; businessName: string | undefined }) {
  return (
    <li className="list-item">
      <Link to={`/chips/${tag.slug}`} className="chip-main">
        <div className="truncate">
          <strong>#{tag.number}</strong> <code className="chip-code">{tag.slug}</code>
          {tag.label && <span className="muted"> · {tag.label}</span>}
        </div>
        <div className="small truncate">
          {tag.businessId ? (
            <span>{businessName ?? 'Negocio'}</span>
          ) : (
            <span className="muted">Libre</span>
          )}
          {tag.targetUrl && <span className="muted"> → {tag.targetUrl}</span>}
        </div>
      </Link>
      <div className="badges">
        {!tag.businessId && <Badge tone="info">Libre</Badge>}
        <TagBadges tag={tag} />
        <CopyButton text={tag.urls.nfc} label="Copiar URL" />
      </div>
    </li>
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
      notify('success', `${created} chip(s) libres creados.`);
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
        {saving ? 'Creando…' : 'Crear chips libres'}
      </button>
    </form>
  );
}
