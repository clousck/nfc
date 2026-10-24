import { LOYALTY_MAX_VISITS, LOYALTY_MIN_VISITS } from '@nfc/shared';
import type { AuditView } from '../audit.js';
import { esc, TIME_ZONE } from '../html.js';
import type { ProjectedTag } from '../internal/control-plane.js';
import type { LoyaltySummary } from '../loyalty/store.js';
import { layout } from './pages.js';
import type { PortalBusiness, PortalSession } from './session.js';

// Páginas de un negocio dentro del portal. Sin JavaScript: las confirmaciones usan <details>.

const dateTime = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const fmt = (ms: number) => dateTime.format(new Date(ms));

/** Mensajes tras guardar (el código va en la URL; el texto nunca). */
export const FLASH = {
  guardado: { ok: true, text: 'Cambios guardados. Tardan hasta un minuto en verse en el chip.' },
  sin_cambios: { ok: true, text: 'No había cambios que guardar.' },
  pausado: {
    ok: true,
    text: 'Chip pausado. Ya avisamos a tu proveedor para reponer o revisar el stand.',
  },
  reactivado: { ok: true, text: 'Chip reactivado.' },
  premio: { ok: true, text: 'Visitas del premio guardadas.' },
  url_invalida: { ok: false, text: 'El destino debe ser una dirección https:// válida.' },
  falta_destino: { ok: false, text: 'Este chip necesita un destino para funcionar.' },
  visitas_invalidas: {
    ok: false,
    text: `Las visitas deben ser un número entre ${LOYALTY_MIN_VISITS} y ${LOYALTY_MAX_VISITS}.`,
  },
  premio_inactivo: {
    ok: false,
    text: 'El programa de fidelidad no está activo. Pídeselo a tu proveedor.',
  },
} as const satisfies Record<string, { ok: boolean; text: string }>;
export type FlashCode = keyof typeof FLASH;

export function isFlashCode(value: string | undefined): value is FlashCode {
  return value !== undefined && Object.hasOwn(FLASH, value);
}

function flash(code: FlashCode | null): string {
  if (!code) return '';
  const { ok, text } = FLASH[code];
  return `<p class="${ok ? 'ok' : 'alert'}" role="status">${esc(text)}</p>`;
}

function nav(business: PortalBusiness, session: PortalSession, loyalty: boolean): string {
  const base = `/n/${esc(business.id)}`;
  const back = session.businesses.length > 1 ? `<a href="/">← Tus negocios</a> · ` : '';
  return `<p class="small">${back}<a href="${base}">Chips</a> · <a href="${base}/estadisticas">Estadísticas</a>${
    loyalty ? ` · <a href="${base}/contactos.csv">Contactos (CSV)</a>` : ''
  } · <a href="${base}/actividad">Actividad</a></p>`;
}

function status(tag: ProjectedTag): string {
  if (tag.pausedAt) return '<span class="tag tag-warn">Pausado: stand perdido o dañado</span>';
  if (!tag.active) return '<span class="tag">Desactivado por tu proveedor</span>';
  if (tag.type === 'redirect' && !tag.targetUrl)
    return '<span class="tag tag-warn">Sin destino</span>';
  return '<span class="tag tag-ok">Funcionando</span>';
}

const TYPE_LABEL: Record<ProjectedTag['type'], string> = {
  redirect: 'Redirección',
  loyalty: 'Tarjeta de fidelidad',
  landing: 'Página',
};

function chipCard(businessId: string, tag: ProjectedTag): string {
  const action = `/n/${esc(businessId)}/chips/${esc(tag.slug)}`;
  const target =
    tag.type === 'landing'
      ? ''
      : `<label>${tag.type === 'redirect' ? 'Destino' : 'Enlace después de sumar el sello (opcional)'}
      <input type="url" name="destino" maxlength="2048" placeholder="https://…" ${tag.type === 'redirect' ? 'required' : ''} value="${esc(tag.targetUrl ?? '')}">
    </label>`;
  const pause = tag.pausedAt
    ? `<form method="post" action="${action}/pausa"><input type="hidden" name="accion" value="reactivar">
      <p class="small muted">Pausado el ${esc(fmt(tag.pausedAt))}. Si el stand vuelve a estar en su sitio, reactívalo.</p>
      <button type="submit" class="btn">Reactivar chip</button></form>`
    : `<details><summary class="small">¿Se perdió o se dañó el stand?</summary>
      <form method="post" action="${action}/pausa" class="stack">
        <input type="hidden" name="accion" value="pausar">
        <p class="small muted">El chip dejará de funcionar (mostrará "Enlace no disponible") para que nadie lo use fuera de tu local, y avisaremos a tu proveedor para reponerlo. Puedes reactivarlo cuando quieras.</p>
        <button type="submit" class="btn">Sí, pausar este chip</button>
      </form></details>`;
  return `<section class="card">
  <h2>Chip #${tag.number}${tag.label ? ` · ${esc(tag.label)}` : ''}</h2>
  <p class="small">${status(tag)} <span class="muted">${TYPE_LABEL[tag.type]}</span></p>
  <form method="post" action="${action}" class="stack">
    <label>Etiqueta (para reconocerlo)
      <input name="etiqueta" maxlength="80" placeholder="Caja, Mesa 3…" value="${esc(tag.label ?? '')}">
    </label>
    ${target}
    <button type="submit" class="btn btn-primary">Guardar</button>
  </form>
  ${pause}
</section>`;
}

function rewardSection(
  businessId: string,
  visits: number | null,
  summary: LoyaltySummary | null,
): string {
  if (visits === null || !summary) return '';
  return `<section class="card">
  <h2>Programa de fidelidad</h2>
  <p class="small muted">Últimos 30 días: ${summary.stamps30} sellos · ${summary.redemptions30} premios canjeados · ${summary.activeCards} tarjetas activas de ${summary.cards}.</p>
  <form method="post" action="/n/${esc(businessId)}/premio" class="stack">
    <label>Visitas para el premio
      <input type="number" name="visitas" required min="${LOYALTY_MIN_VISITS}" max="${LOYALTY_MAX_VISITS}" value="${visits}">
    </label>
    <p class="small muted">Las tarjetas que ya tienen sellos los conservan. El premio en sí lo entregas tú en el local.</p>
    <button type="submit" class="btn btn-primary">Guardar</button>
  </form>
</section>`;
}

export function businessPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  tags: ProjectedTag[];
  loyaltyVisits: number | null;
  loyalty: LoyaltySummary | null;
  flash: FlashCode | null;
}): string {
  const { business, session } = input;
  const paused =
    business.status === 'paused'
      ? '<p class="alert">Tu negocio está pausado: los chips no funcionan hasta que tu proveedor lo reactive.</p>'
      : '';
  const chips =
    input.tags.length === 0
      ? '<section class="card"><p class="muted">Todavía no tienes chips asignados.</p></section>'
      : input.tags.map((t) => chipCard(business.id, t)).join('\n');
  return layout(
    business.name,
    `${nav(business, session, input.loyaltyVisits !== null)}
<h1>${esc(business.name)}</h1>
${flash(input.flash)}
${paused}
${rewardSection(business.id, input.loyaltyVisits, input.loyalty)}
${chips}`,
    session,
  );
}

// ---------- Actividad (auditoría) ----------

const FIELD_LABEL: Record<string, string> = {
  targetUrl: 'destino',
  label: 'etiqueta',
  loyaltyVisits: 'visitas del premio',
};

const show = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value);

function describe(entry: AuditView): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  switch (entry.action) {
    case 'tag.settings': {
      const parts: string[] = [];
      for (const key of Object.keys(after)) {
        if (key === 'pausedAt') {
          parts.push(after[key] ? 'lo pausó (stand perdido o dañado)' : 'lo reactivó');
        } else {
          parts.push(
            `${FIELD_LABEL[key] ?? key}: ${esc(show(before[key]))} → ${esc(show(after[key]))}`,
          );
        }
      }
      const chip = entry.tagNumber ? `Chip #${entry.tagNumber}` : 'Chip';
      return `${chip}: ${parts.join('; ')}`;
    }
    case 'business.settings':
      return `Visitas del premio: ${esc(show(before['loyaltyVisits']))} → ${
        after['loyaltyVisits'] === null ? 'programa desactivado' : esc(show(after['loyaltyVisits']))
      }`;
    case 'account.added':
      return `Dio acceso al portal a ${esc(show(after['email']))}`;
    case 'account.removed':
      return `Quitó el acceso al portal a ${esc(show(before['email']))}`;
    case 'contacts.exported':
      return `Descargó los contactos de fidelidad (${esc(show(after['count']))})`;
    default:
      return esc(entry.action);
  }
}

function actor(entry: AuditView): string {
  if (entry.actorType === 'admin') return 'Tu proveedor';
  return esc(entry.actorLabel ?? (entry.actorType === 'owner' ? 'Dueño' : 'Personal'));
}

export function activityPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  entries: AuditView[];
  loyalty: boolean;
}): string {
  const rows =
    input.entries.length === 0
      ? '<p class="muted">Todavía no hay cambios registrados.</p>'
      : `<ul class="plain">${input.entries
          .map(
            (e) =>
              `<li><div>${describe(e)}</div><div class="small muted">${esc(fmt(e.ts))} · ${actor(e)}</div></li>`,
          )
          .join('')}</ul>`;
  return layout(
    `Actividad · ${input.business.name}`,
    `${nav(input.business, input.session, input.loyalty)}
<h1>Actividad</h1>
<section class="card">
  <p class="small muted">Cada cambio en la configuración de tu negocio queda registrado: quién lo hizo, qué cambió y cuándo. Se guarda un año.</p>
  ${rows}
</section>`,
    input.session,
  );
}
