import { useState, type ReactNode } from 'react';
import type { Business, Tag } from './api';

const dateFormat = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(ms: number | null | undefined): string {
  return ms ? dateFormat.format(new Date(ms)) : '—';
}

export const STATUS_LABELS: Record<Business['status'], string> = {
  active: 'Activo',
  paused: 'Pausado',
  cancelled: 'Cancelado',
};

export const PLAN_LABELS: Record<Business['plan'], string> = {
  basic: 'Básico',
  premium: 'Premium',
};

export function Badge({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'muted' | 'info';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function BusinessStatusBadge({ status }: { status: Business['status'] }) {
  const tone = status === 'active' ? 'ok' : status === 'paused' ? 'warn' : 'muted';
  return <Badge tone={tone}>{STATUS_LABELS[status]}</Badge>;
}

export function TagBadges({ tag }: { tag: Tag }) {
  return (
    <>
      {tag.type === 'loyalty' ? <Badge tone="info">Fidelidad</Badge> : null}
      {tag.active ? <Badge tone="ok">Activo</Badge> : <Badge tone="muted">Inactivo</Badge>}
      {tag.lockedAt ? <Badge tone="info">Bloqueado</Badge> : null}
      {tag.pausedAt ? <Badge tone="warn">Pausado por el negocio</Badge> : null}
      {tag.businessId && !tag.syncedAt ? <Badge tone="warn">Sin publicar</Badge> : null}
    </>
  );
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button button-small"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? '¡Copiado!' : label}
    </button>
  );
}

export function Loading() {
  return <p className="muted">Cargando…</p>;
}

export function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="card card-error">
      <p>{error.message}</p>
      <button type="button" className="button" onClick={retry}>
        Reintentar
      </button>
    </div>
  );
}

/** Convierte "" en null para los campos opcionales de texto. */
export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export type ChipMode = 'redirect' | 'loyalty';

/** Selector del modo del chip, con explicación de cada opción. */
export function ChipModeField({
  value,
  onChange,
}: {
  value: ChipMode;
  onChange: (mode: ChipMode) => void;
}) {
  return (
    <label>
      Modo
      <select
        className="input"
        name="type"
        value={value}
        onChange={(e) => onChange(e.target.value === 'loyalty' ? 'loyalty' : 'redirect')}
      >
        <option value="redirect">Directo: lleva al destino</option>
        <option value="loyalty">Fidelidad: tarjeta de sellos y luego el destino</option>
      </select>
      <span className="hint">
        {value === 'loyalty'
          ? 'Cada acercamiento suma 1 sello al día. Los chips de fidelidad no tienen QR.'
          : 'Va directo a reseñas, WhatsApp, menú… Puede tener QR.'}
      </span>
    </label>
  );
}
