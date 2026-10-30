import { useEffect, useState, type ReactNode } from 'react';
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

const ICON_PATHS: Record<string, string> = {
  inicio: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z',
  negocios:
    'M4 9.5 5.5 5h13L20 9.5M4 9.5h16M4 9.5v.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0v-.5M5.5 12.5V19h13v-6.5M10 19v-4h4v4',
  chips:
    'M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM10 9.5a3.5 3.5 0 0 1 0 5M13 8a6 6 0 0 1 0 8',
  ajustes:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.1 1.2L10 21h4l.5-2.6a7 7 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  menu: 'M4 7h16M4 12h16M4 17h16',
};

export function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof ICON_PATHS | string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name] ?? ''} />
    </svg>
  );
}

/** Marca de PengineXR: un sello circular con dos arcos de NFC (la misma que en el Worker). */
export function Mark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="9.5" cy="12" r="6.5" />
      <circle cx="9.5" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <path d="M18 8a6.5 6.5 0 0 1 0 8" />
      <path d="M21 5.5a10.5 10.5 0 0 1 0 13" />
    </svg>
  );
}

/** Cabecera de página: migas, título con sus pastillas, una línea y las acciones. */
export function PageHead({
  crumbs,
  title,
  badges,
  sub,
  actions,
}: {
  crumbs?: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {crumbs && <p className="crumbs">{crumbs}</p>}
        <div className="title-line">
          <h1>{title}</h1>
          {badges}
        </div>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

/** Panel lateral (crear un negocio, etc.). Escape o clic fuera lo cierran. */
export function Drawer({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </>
  );
}
