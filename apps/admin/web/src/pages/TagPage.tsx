import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, qrUrl, type Business, type TagView } from '../api';
import { TAG_STATE_LABEL, TAG_STATE_TONE, tagState } from '../chips';
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
  PageHead,
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
  const state = tagState(data);

  return (
    <>
      <PageHead
        crumbs={
          owner ? (
            <>
              <Link to="/negocios">Negocios</Link>
              <span>/</span>
              <Link to={`/negocios/${owner.id}`}>{owner.name}</Link>
            </>
          ) : (
            <Link to="/chips?ver=libres">Chips libres</Link>
          )
        }
        title={
          <>
            Chip #{data.number}
            {data.label && <span className="muted"> · {data.label}</span>}
          </>
        }
        badges={
          <>
            <span className={`badge badge-${TAG_STATE_TONE[state]}`}>{TAG_STATE_LABEL[state]}</span>
            {data.type === 'loyalty' && <span className="badge badge-info">Fidelidad</span>}
          </>
        }
        sub={
          <>
            Código <span className="chip-code">{data.slug}</span> · creado{' '}
            {formatDate(data.createdAt)} · publicado {formatDate(data.syncedAt)}
          </>
        }
      />

      {data.pausedAt && <PausedNotice tag={data} onChanged={tag.reload} />}
      {data.businessId && !data.published && !data.pausedAt && (
        <div className="card card-warning">
          Este chip no redirige a ningún lado todavía: falta el destino.
        </div>
      )}

      <div className="layout">
        <div>
          {/* El selector de negocio necesita la lista cargada: si se dibujara vacío quedaría en
              "Sin asignar" y al guardar desasignaría el chip. */}
          {businesses.data ? (
            <TagForm
              key={JSON.stringify(data)}
              tag={data}
              businesses={businesses.data}
              onSaved={tag.reload}
            />
          ) : businesses.error ? (
            <LoadError error={businesses.error} retry={businesses.reload} />
          ) : (
            <Loading />
          )}
          <NfcWriter tag={data} onLocked={tag.reload} />
          <ScanStats tag={data} businessName={owner?.name} />
        </div>

        <div>
          {data.type === 'loyalty' ? (
            <section>
              <h2>Para grabar</h2>
              <div className="card">
                <UrlLine title="URL del chip NFC" url={data.urls.nfc} />
                <p className="hint">
                  Los chips de fidelidad no tienen QR fijo: con esa URL cualquiera podría sumar
                  sellos sin ir al local. Para sellar por QR, el local muestra el QR del día.
                </p>
              </div>
            </section>
          ) : (
            <section>
              <h2>Para grabar e imprimir</h2>
              <div className="card qr-card">
                <img
                  src={qrUrl(data.slug, 'svg')}
                  alt={`Código QR del chip ${data.number}`}
                  className="qr"
                />
                <div className="actions">
                  <a className="button button-small" href={qrUrl(data.slug, 'svg', true)}>
                    SVG para imprenta
                  </a>
                  <a className="button button-small" href={qrUrl(data.slug, 'png', true)}>
                    PNG
                  </a>
                </div>
              </div>
              <div className="card">
                <UrlLine title="URL del chip NFC" url={data.urls.nfc} />
                <UrlLine title="URL del código QR (cuenta aparte)" url={data.urls.qr} />
              </div>
            </section>
          )}
          <TagDangerZone tag={data} onChanged={tag.reload} />
        </div>
      </div>
    </>
  );
}

function UrlLine({ title, url }: { title: string; url: string }) {
  return (
    <div className="url-line">
      <p className="small">
        <strong>{title}</strong>
      </p>
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
      const next = {
        type: mode,
        businessId: emptyToNull(String(form.get('businessId') ?? '')),
        label: emptyToNull(String(form.get('label') ?? '')),
        targetUrl: emptyToNull(String(form.get('targetUrl') ?? '')),
        active: form.get('active') === 'on',
      };
      // Solo se envía lo que cambió: un campo que no tocaste nunca se modifica sin querer.
      const changes = Object.fromEntries(
        Object.entries(next).filter(([key, value]) => tag[key as keyof typeof next] !== value),
      ) as Partial<typeof next>;
      if (Object.keys(changes).length === 0) {
        reportSync(undefined, 'No había cambios que guardar.');
        return;
      }
      if (
        'businessId' in changes &&
        changes.businessId === null &&
        !confirm(
          '¿Quitar este chip de su negocio? Dejará de redirigir hasta que lo vuelvas a asignar.',
        )
      ) {
        return;
      }
      const result = await api.updateTag(tag.slug, changes);
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
        <div className="row">
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
        </div>
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

  return (
    <section>
      <h2>Zona de peligro</h2>
      <div className="card">
        {tag.lockedAt ? (
          <p className="muted">
            Grabado y bloqueado el {formatDate(tag.lockedAt)}: si el negocio lo deja, desactívalo o
            reasígnalo a otro.
          </p>
        ) : (
          <div className="actions actions-start">
            <button type="button" className="button" onClick={() => void lock()}>
              Ya lo bloqueé con otra app
            </button>
            <button type="button" className="button button-danger" onClick={() => void remove()}>
              Borrar chip
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** El negocio marcó el stand como perdido o dañado: el chip no funciona hasta reactivarlo. */
function PausedNotice({ tag, onChanged }: { tag: TagView; onChanged: () => void }) {
  const { reportSync, reportError } = useNotices();
  const [saving, setSaving] = useState(false);

  async function reactivate() {
    setSaving(true);
    try {
      const result = await api.updateTag(tag.slug, { paused: false });
      reportSync(result.sync, 'Chip reactivado. El cambio tarda hasta un minuto en verse.');
      onChanged();
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-warning notice-row">
      <p>
        El negocio pausó este chip ({tag.pausedAt ? formatDate(tag.pausedAt) : ''}): stand perdido o
        dañado. Muestra "Enlace no disponible" hasta que se reactive.
      </p>
      <button type="button" className="button" disabled={saving} onClick={() => void reactivate()}>
        {saving ? 'Reactivando…' : 'Reactivar chip'}
      </button>
    </div>
  );
}
