import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, qrUrl, type Business, type TagView } from '../api';
import { NfcWriter } from '../components/NfcWriter';
import { ScanStats } from '../components/ScanStats';
import { useResource } from '../hooks';
import { useNotices } from '../notices';
import {
  ChipModeField,
  CopyButton,
  emptyToNull,
  formatDate,
  LoadError,
  Loading,
  TagBadges,
  type ChipMode,
} from '../ui';

export function TagPage() {
  const { slug = '' } = useParams();
  const tag = useResource(() => api.getTag(slug), `tag:${slug}`);
  const businesses = useResource(api.listBusinesses, 'businesses');

  if (tag.error) return <LoadError error={tag.error} retry={tag.reload} />;
  if (!tag.data) return <Loading />;
  const data = tag.data;
  const owner = businesses.data?.find((b) => b.id === data.businessId);

  return (
    <>
      <p className="breadcrumb">
        {owner ? (
          <Link to={`/negocios/${owner.id}`}>← {owner.name}</Link>
        ) : (
          <Link to="/chips?ver=libres">← Chips libres</Link>
        )}
      </p>
      <div className="page-title">
        <h1>
          Chip #{data.number}
          {data.label && <span className="muted"> · {data.label}</span>}
        </h1>
        <div className="badges">
          <TagBadges tag={data} />
        </div>
      </div>

      {data.businessId && !data.published && (
        <div className="card card-warning">
          Este chip no redirige a ningún lado todavía: falta el destino.
        </div>
      )}

      {data.type === 'loyalty' ? (
        <section className="card">
          <h2>Para grabar</h2>
          <UrlLine
            title="URL del chip NFC"
            hint="Esta es la que se graba en el chip."
            url={data.urls.nfc}
          />
          <p className="hint">
            Los chips de fidelidad no tienen QR: con la URL del QR cualquiera podría sumar sellos
            sin ir al local.
          </p>
        </section>
      ) : (
        <div className="grid-2">
          <section className="card">
            <h2>Para grabar e imprimir</h2>
            <UrlLine
              title="URL del chip NFC"
              hint="Esta es la que se graba en el chip."
              url={data.urls.nfc}
            />
            <UrlLine
              title="URL del código QR"
              hint="Lleva ?s=q para contar los escaneos por QR aparte."
              url={data.urls.qr}
            />
          </section>

          <section className="card qr-card">
            <h2>Código QR</h2>
            <img src={qrUrl(data.slug, 'svg')} alt={`Código QR de ${data.slug}`} className="qr" />
            <div className="actions">
              <a className="button button-small" href={qrUrl(data.slug, 'svg', true)}>
                Descargar SVG
              </a>
              <a className="button button-small" href={qrUrl(data.slug, 'png', true)}>
                Descargar PNG
              </a>
            </div>
            <p className="hint">SVG para imprenta (no pierde calidad), PNG para todo lo demás.</p>
          </section>
        </div>
      )}

      <NfcWriter tag={data} onLocked={tag.reload} />

      <ScanStats tag={data} businessName={owner?.name} />

      <TagForm
        key={JSON.stringify(data)}
        tag={data}
        businesses={businesses.data ?? []}
        onSaved={tag.reload}
      />
      <TagDangerZone tag={data} onChanged={tag.reload} />
    </>
  );
}

function UrlLine({ title, hint, url }: { title: string; hint: string; url: string }) {
  return (
    <div className="url-line">
      <div className="small">
        <strong>{title}</strong> <span className="muted">— {hint}</span>
      </div>
      <div className="url-box">
        <code className="truncate">{url}</code>
        <CopyButton text={url} />
      </div>
    </div>
  );
}

function TagForm({
  tag,
  businesses,
  onSaved,
}: {
  tag: TagView;
  businesses: Business[];
  onSaved: () => void;
}) {
  const { reportSync, reportError } = useNotices();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ChipMode>(tag.type === 'loyalty' ? 'loyalty' : 'redirect');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const result = await api.updateTag(tag.slug, {
        type: mode,
        businessId: emptyToNull(String(form.get('businessId') ?? '')),
        label: emptyToNull(String(form.get('label') ?? '')),
        targetUrl: emptyToNull(String(form.get('targetUrl') ?? '')),
        active: form.get('active') === 'on',
      });
      reportSync(result.sync, 'Chip guardado. El cambio tarda hasta un minuto en verse.');
      onSaved();
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>Configuración</h2>
      <form className="card form" onSubmit={submit}>
        <label>
          Negocio
          <select className="input" name="businessId" defaultValue={tag.businessId ?? ''}>
            <option value="">— Sin asignar (chip libre) —</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Etiqueta
          <input
            className="input"
            name="label"
            defaultValue={tag.label ?? ''}
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
            defaultValue={tag.targetUrl ?? ''}
            placeholder="https://…"
          />
          <span className="hint">
            Puedes cambiarlo cuando quieras; el chip no se vuelve a grabar.
          </span>
        </label>
        <label className="checkbox">
          <input type="checkbox" name="active" defaultChecked={tag.active} />
          Activo (si lo desactivas, muestra la página genérica)
        </label>
        <p className="muted small">
          Código interno: <code>{tag.slug}</code> · Creado: {formatDate(tag.createdAt)} · Publicado
          en Cloudflare: {formatDate(tag.syncedAt)}
          {tag.lockedAt ? ` · Bloqueado: ${formatDate(tag.lockedAt)}` : ''}
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </section>
  );
}

function TagDangerZone({ tag, onChanged }: { tag: TagView; onChanged: () => void }) {
  const navigate = useNavigate();
  const { notify, reportSync, reportError } = useNotices();

  async function lock() {
    if (
      !confirm(
        '¿Ya grabaste y bloqueaste este chip físico? Esto solo lo deja anotado; desde ahora no se podrá borrar.',
      )
    ) {
      return;
    }
    try {
      await api.lockTag(tag.slug);
      notify('success', 'Chip marcado como bloqueado.');
      onChanged();
    } catch (err) {
      reportError(err);
    }
  }

  async function remove() {
    if (!confirm(`¿Borrar el chip #${tag.number}? No se puede deshacer.`)) return;
    try {
      const result = await api.deleteTag(tag.slug);
      reportSync(result.sync, 'Chip borrado.');
      navigate(tag.businessId ? `/negocios/${tag.businessId}` : '/chips?ver=libres');
    } catch (err) {
      reportError(err);
    }
  }

  if (tag.lockedAt) {
    return (
      <p className="muted small">
        Este chip ya está grabado y bloqueado. Si el negocio lo deja, desactívalo o reasígnalo a
        otro.
      </p>
    );
  }

  return (
    <div className="actions actions-start">
      <button type="button" className="button" onClick={lock}>
        Ya lo bloqueé con otra app
      </button>
      <button type="button" className="button button-danger" onClick={remove}>
        Borrar chip
      </button>
    </div>
  );
}
