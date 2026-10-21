import { api, type TagView } from '../api';
import { useResource } from '../hooks';
import { formatDate } from '../ui';

const OS_LABELS: Record<string, string> = { ios: 'iPhone', android: 'Android', other: 'Otro' };

/** Resumen de escaneos del chip desde que se asignó a su negocio actual. */
export function ScanStats({ tag, businessName }: { tag: TagView; businessName?: string }) {
  const stats = useResource(() => api.getTagScans(tag.slug), `scans:${tag.slug}:${tag.assignedAt}`);

  return (
    <section>
      <div className="section-title">
        <h2>Escaneos</h2>
        <button
          type="button"
          className="button button-small"
          onClick={stats.reload}
          disabled={stats.loading}
        >
          {stats.loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {stats.error && <div className="card card-warning">{stats.error.message}</div>}

      {stats.data && (
        <div className="card">
          <p className="muted small scan-since">
            {stats.data.since
              ? `Desde que se asignó${businessName ? ` a ${businessName}` : ''} el ${formatDate(stats.data.since)}.`
              : 'Desde que se creó el chip.'}{' '}
            Último escaneo: {formatDate(stats.data.lastAt)}.
          </p>

          <div className="stats">
            <Stat label="Total" value={stats.data.total} highlight />
            <Stat label="Chip NFC" value={stats.data.nfc} />
            <Stat label="Código QR" value={stats.data.qr} />
            <Stat label="iPhone" value={stats.data.ios} />
            <Stat label="Android" value={stats.data.android} />
            <Stat label="Otros" value={stats.data.other} />
          </div>

          {stats.data.bots > 0 && (
            <p className="hint">
              Además hubo {stats.data.bots} visita(s) automáticas (vistas previas de WhatsApp,
              buscadores…) que no se cuentan.
            </p>
          )}

          {stats.data.recent.length > 0 && (
            <>
              <h3 className="small">Últimos escaneos</h3>
              <ul className="scan-list">
                {stats.data.recent.map((scan) => (
                  <li key={`${scan.ts}-${scan.source}`}>
                    <span>{formatDate(scan.ts)}</span>
                    <span className="badges">
                      <span className="badge badge-muted">
                        {scan.source === 'qr' ? 'QR' : 'NFC'}
                      </span>
                      <span className="badge badge-muted">
                        {OS_LABELS[scan.os ?? 'other'] ?? 'Otro'}
                      </span>
                    </span>
                    <span className="muted">
                      {[scan.city, scan.country].filter(Boolean).join(', ') || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`stat${highlight ? ' stat-highlight' : ''}`}>
      <div className="stat-value">{value.toLocaleString('es-EC')}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
