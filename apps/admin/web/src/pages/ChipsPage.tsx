import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, type Business } from '../api';
import { host, TAG_STATE_LABEL, TAG_STATE_TONE, tagState } from '../chips';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import { CopyButton, emptyToNull, LoadError, Loading, PageHead } from '../ui';

const MAX_BATCH = 50;

type Filter = 'todos' | 'libres' | 'ocupados' | 'pausados';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'libres', label: 'Libres' },
  { value: 'ocupados', label: 'En uso' },
  { value: 'pausados', label: 'Pausados o sin destino' },
];

function parseFilter(value: string | null): Filter {
  return FILTERS.some((f) => f.value === value) ? (value as Filter) : 'todos';
}

export function ChipsPage() {
  const navigate = useNavigate();
  const tags = useResource(() => api.listTags(), 'all-tags');
  const businesses = useResource(api.listBusinesses, 'businesses');
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get('ver'));
  const [search, setSearch] = useState('');

  const names = new Map((businesses.data ?? []).map((b: Business) => [b.id, b.name]));
  const all = [...(tags.data ?? [])].sort((a, b) => a.number - b.number);
  const term = search.trim().toLowerCase().replace(/^#/, '');
  const matches = all.filter((tag) => {
    if (term === '') return true;
    const business = tag.businessId ? (names.get(tag.businessId) ?? '') : '';
    return (
      String(tag.number) === term ||
      tag.slug.toLowerCase().includes(term) ||
      (tag.label ?? '').toLowerCase().includes(term) ||
      business.toLowerCase().includes(term)
    );
  });
  const inFilter = (f: Filter, tag: (typeof all)[number]) => {
    const state = tagState(tag);
    if (f === 'libres') return state === 'free';
    if (f === 'ocupados') return state === 'live' || state === 'locked';
    if (f === 'pausados') return state === 'paused' || state === 'missing' || state === 'off';
    return true;
  };
  const visible = matches.filter((t) => inFilter(filter, t));

  return (
    <>
      <PageHead
        title="Chips"
        sub="El inventario físico: cada chip con su número, su negocio y su estado."
        actions={<CreateBatchForm onCreated={tags.reload} />}
      />

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
            {f.label}
            <span className="tab-count">
              {tags.data ? matches.filter((t) => inFilter(f.value, t)).length : '…'}
            </span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Número, código, etiqueta o negocio"
          aria-label="Buscar chips"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="small muted">
          {visible.length} {visible.length === 1 ? 'chip' : 'chips'}
        </span>
      </div>

      {tags.error && <LoadError error={tags.error} retry={tags.reload} />}
      {tags.loading && !tags.data && <Loading />}
      {tags.data &&
        (visible.length === 0 ? (
          <div className="empty">
            {term
              ? 'Ningún chip coincide con la búsqueda.'
              : filter === 'libres'
                ? 'No hay chips libres. Crea algunos con «Crear chips libres».'
                : filter === 'todos'
                  ? 'Todavía no hay chips.'
                  : 'Ningún chip en este estado.'}
          </div>
        ) : (
          <div className="table-frame table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Chip</th>
                  <th className="hide-sm">Código</th>
                  <th>Negocio</th>
                  <th className="hide-sm">Destino</th>
                  <th>Estado</th>
                  <th className="hide-sm" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {visible.map((tag) => {
                  const state = tagState(tag);
                  return (
                    <tr key={tag.slug} onClick={() => navigate(`/chips/${tag.slug}`)}>
                      <td className="ident">
                        <strong>
                          <Link to={`/chips/${tag.slug}`} onClick={(e) => e.stopPropagation()}>
                            <span className="chip-no">#{tag.number}</span>
                          </Link>
                        </strong>
                        <span>{tag.label ?? (tag.type === 'loyalty' ? 'Fidelidad' : '—')}</span>
                      </td>
                      <td className="hide-sm">
                        <span className="chip-code">{tag.slug}</span>
                      </td>
                      <td className="truncate">
                        {tag.businessId ? (
                          (names.get(tag.businessId) ?? 'Negocio')
                        ) : (
                          <span className="muted">Libre</span>
                        )}
                      </td>
                      <td className="truncate hide-sm">
                        {tag.type === 'loyalty' ? 'Tarjeta de sellos' : ''}
                        {tag.type === 'loyalty' && tag.targetUrl ? ' → ' : ''}
                        {host(tag.targetUrl) ||
                          (tag.type === 'loyalty' ? '' : <span className="muted">—</span>)}
                      </td>
                      <td>
                        <span className={`badge badge-${TAG_STATE_TONE[state]}`}>
                          {TAG_STATE_LABEL[state]}
                        </span>
                      </td>
                      <td className="hide-sm cell-end" onClick={(e) => e.stopPropagation()}>
                        <CopyButton text={tag.urls.nfc} label="Copiar URL" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
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
    <form className="form-inline batch" onSubmit={submit}>
      <label>
        <span className="small muted">Cantidad</span>
        <input
          className="input"
          name="count"
          type="number"
          min={1}
          max={MAX_BATCH}
          defaultValue={1}
          aria-label="Cantidad de chips"
        />
      </label>
      <label>
        <span className="small muted">Etiqueta del lote</span>
        <input className="input" name="label" placeholder="Lote octubre" maxLength={80} />
      </label>
      <button type="submit" className="button button-primary" disabled={saving}>
        {saving ? 'Creando…' : 'Crear chips libres'}
      </button>
    </form>
  );
}
