import {
  LOYALTY_MAX_VISITS,
  LOYALTY_MIN_VISITS,
  MAX_STAFF_DEVICES,
  type PairingResponse,
  type StaffDeviceSummary,
} from '@nfc/shared';
import type { AuditView } from '../audit.js';
import { esc, TIME_ZONE } from '../html.js';
import type { ProjectedTag } from '../internal/control-plane.js';
import { qrSvg } from '../loyalty/pages.js';
import type { LoyaltySummary } from '../loyalty/store.js';
import type { ReportRecord } from '@nfc/shared';
import type { ReportStats } from '../report.js';
import {
  REPORT_STYLES,
  reportContent,
  reportFootnote,
  type ReportLoyalty,
} from '../report-page.js';
import { appLayout, type NavKey } from './pages.js';
import type { PortalBusiness, PortalSession } from './session.js';
import type { TodayVisits } from './today.js';

// Páginas de un negocio dentro del portal (docs/UI.md §4). Sin JavaScript: las ediciones y
// confirmaciones se despliegan con <details>.

const dateTime = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const timeOnly = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});
const dayName = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
const dayShort = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'short',
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
  qr_rotado: { ok: true, text: 'Clave cambiada: los QR anteriores y sus fotos ya no sirven.' },
  premio: { ok: true, text: 'Visitas del premio guardadas.' },
  url_invalida: { ok: false, text: 'El destino debe ser una dirección https:// válida.' },
  falta_destino: { ok: false, text: 'Este chip necesita un destino para funcionar.' },
  visitas_invalidas: {
    ok: false,
    text: `Las visitas deben ser un número entre ${LOYALTY_MIN_VISITS} y ${LOYALTY_MAX_VISITS}.`,
  },
  vinculado_revocado: { ok: true, text: 'Móvil desvinculado: ya no puede validar canjes.' },
  nombre_invalido: { ok: false, text: 'Ponle un nombre al móvil (por ejemplo «Caja – María»).' },
  demasiados_moviles: {
    ok: false,
    text: `Ya tienes ${MAX_STAFF_DEVICES} móviles vinculados. Desvincula uno antes de añadir otro.`,
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
  return `<p class="notice ${ok ? 'notice-ok' : 'notice-bad'} flash" role="status">${esc(text)}</p>`;
}

function page(input: {
  title: string;
  session: PortalSession;
  business: PortalBusiness;
  current: NavKey;
  loyalty: boolean;
  body: string;
  extraHead?: string;
}): string {
  return appLayout({
    ...input,
    extraHead: `<style>${BUSINESS_STYLES}</style>${input.extraHead ?? ''}`,
  });
}

function head(title: string, sub: string, action = ''): string {
  return `<div class="page-head">
  <div><h1>${title}</h1><p class="page-sub">${sub}</p></div>
  ${action}
</div>`;
}

/** Dominio del destino, para leerlo de un vistazo ("instagram.com"). */
function host(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function status(tag: ProjectedTag): string {
  if (tag.pausedAt) return '<span class="pill pill-warn">Pausado</span>';
  if (!tag.active) return '<span class="pill">Desactivado</span>';
  if (tag.type === 'redirect' && !tag.targetUrl)
    return '<span class="pill pill-warn">Sin destino</span>';
  return '<span class="pill pill-ok">Funcionando</span>';
}

const TYPE_LABEL: Record<ProjectedTag['type'], string> = {
  redirect: 'Redirección',
  loyalty: 'Tarjeta de sellos',
  landing: 'Página',
};

function chipLine(tag: ProjectedTag): string {
  const dest = host(tag.targetUrl);
  return `${TYPE_LABEL[tag.type]}${dest ? ` · ${esc(dest)}` : ''}`;
}

// ---------- Hoy ----------

const STRIP_FROM = 6;
const STRIP_TO = 22;

function stripPosition(ms: number, dayStart: number): number {
  const hour = (ms - dayStart) / 3_600_000;
  return Math.min(100, Math.max(0, ((hour - STRIP_FROM) / (STRIP_TO - STRIP_FROM)) * 100));
}

function ago(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  return `a las ${timeOnly.format(new Date(ms))}`;
}

/** La franja del día: una marca por visita sobre el eje de 6:00 a 22:00. */
function dayStrip(today: TodayVisits, now: number): string {
  const unit =
    today.kind === 'stamps'
      ? today.times.length === 1
        ? 'sello'
        : 'sellos'
      : today.times.length === 1
        ? 'escaneo'
        : 'escaneos';
  const last = today.times[today.times.length - 1];
  const notes = [
    last ? `Último ${ago(last, now)}` : 'Todavía nadie hoy',
    `ayer a esta hora: ${today.yesterdaySameTime}`,
  ];
  const ticks = today.times
    .map(
      (t) =>
        `<span class="tick" style="left:${stripPosition(t, today.dayStart).toFixed(2)}%"></span>`,
    )
    .join('');
  const nowAt = stripPosition(now, today.dayStart).toFixed(2);
  const axis = [6, 10, 14, 18, 22]
    .map(
      (h) =>
        `<span style="left:${(((h - STRIP_FROM) / (STRIP_TO - STRIP_FROM)) * 100).toFixed(2)}%">${h}:00</span>`,
    )
    .join('');
  return `<div class="panel pad today">
  <div>
    <p class="today-n">${today.times.length}<small>${unit}</small></p>
    <p class="today-note">${notes.join(' · ')}</p>
  </div>
  <div>
    <div class="strip" role="img" aria-label="${today.times.length} ${unit} hoy entre las 6:00 y las 22:00">
      <span class="strip-track"></span><span class="strip-past" style="width:${nowAt}%"></span>
      ${ticks}<span class="now" style="left:${nowAt}%"></span>
    </div>
    <div class="strip-axis" aria-hidden="true">${axis}</div>
  </div>
</div>`;
}

function loyaltyBlock(businessId: string, visits: number | null, s: LoyaltySummary | null): string {
  if (visits === null || !s) return '';
  return `<section class="block" aria-labelledby="month-title">
  <div class="block-head"><h2 id="month-title">Últimos 30 días</h2><a href="/n/${esc(businessId)}/estadisticas">Ver estadísticas</a></div>
  <div class="panel pad">
    <dl class="kpis" style="--n:4">
      <div><dt>Sellos</dt><dd>${s.stamps30}</dd><p>visitas con sello</p></div>
      <div><dt>Premios entregados</dt><dd>${s.redemptions30}</dd><p>${s.validated30} ${s.validated30 === 1 ? 'validado' : 'validados'} por tu personal</p></div>
      <div><dt>Tarjetas activas</dt><dd>${s.activeCards}</dd><p>de ${s.cards} creadas</p></div>
      <div><dt>Premio</dt><dd>${visits}<small>visitas</small></dd>
        <details><summary>Cambiar</summary>
          <form method="post" action="/n/${esc(businessId)}/premio" class="stack">
            <label class="field">Visitas para el premio
              <input type="number" name="visitas" required min="${LOYALTY_MIN_VISITS}" max="${LOYALTY_MAX_VISITS}" value="${visits}">
            </label>
            <p class="hint">Las tarjetas que ya tienen sellos los conservan. El premio lo entregas tú en el local.</p>
            <button type="submit" class="btn btn-primary">Guardar</button>
          </form>
        </details>
      </div>
    </dl>
  </div>
</section>`;
}

function chipsBlock(businessId: string, tags: ProjectedTag[]): string {
  const rows =
    tags.length === 0
      ? '<li class="muted">Todavía no tienes chips asignados.</li>'
      : tags
          .map(
            (t) => `<li><span class="chip-no" title="Chip #${t.number}">#${t.number}</span>
  <span class="chip-main"><strong>${t.label ? esc(t.label) : `Chip #${t.number}`}</strong><span>${chipLine(t)}</span></span>
  ${status(t)}</li>`,
          )
          .join('');
  return `<section class="block" aria-labelledby="chips-title">
  <div class="block-head"><h2 id="chips-title">Tus chips</h2><a href="/n/${esc(businessId)}/chips">Editar</a></div>
  <ul class="panel pad rows chip-rows">${rows}</ul>
</section>`;
}

function recentBlock(businessId: string, entries: AuditView[]): string {
  const rows =
    entries.length === 0
      ? '<li class="muted">Todavía no hay cambios registrados.</li>'
      : entries
          .map(
            (e) =>
              `<li><span>${describe(e)}</span><time>${esc(timeOnly.format(new Date(e.ts)))}</time><span class="who">${esc(dayShort.format(new Date(e.ts)))} · ${actor(e)}</span></li>`,
          )
          .join('');
  return `<section class="block" aria-labelledby="recent-title">
  <div class="block-head"><h2 id="recent-title">Actividad reciente</h2><a href="/n/${esc(businessId)}/actividad">Ver todo</a></div>
  <ul class="panel pad rows events">${rows}</ul>
</section>`;
}

export function businessPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  tags: ProjectedTag[];
  loyaltyVisits: number | null;
  loyalty: LoyaltySummary | null;
  today: TodayVisits;
  recent: AuditView[];
  now: number;
  flash: FlashCode | null;
}): string {
  const { business, session } = input;
  const loyalty = input.loyaltyVisits !== null;
  const date = dayName.format(new Date(input.now));
  const paused =
    business.status === 'paused'
      ? '<p class="notice notice-warn flash">Tu negocio está pausado: los chips no funcionan hasta que tu proveedor lo reactive.</p>'
      : '';
  return page({
    title: 'Hoy',
    session,
    business,
    current: 'hoy',
    loyalty,
    body: `${head(
      esc(business.name),
      `Hoy, ${esc(date)}`,
      loyalty
        ? `<a class="btn btn-primary" href="/n/${esc(business.id)}/qr">Mostrar el QR del día</a>`
        : '',
    )}
${flash(input.flash)}
${paused}
<div class="cols">
  <div>
    <section class="block" aria-labelledby="today-title">
      <div class="block-head"><h2 id="today-title">Hoy en el local</h2><span class="small muted">${
        input.today.kind === 'stamps' ? 'Cada marca es un sello' : 'Cada marca es un escaneo'
      }</span></div>
      ${dayStrip(input.today, input.now)}
    </section>
    ${loyaltyBlock(business.id, input.loyaltyVisits, input.loyalty)}
  </div>
  <div>
    ${chipsBlock(business.id, input.tags)}
    ${recentBlock(business.id, input.recent)}
  </div>
</div>`,
  });
}

// ---------- Chips ----------

function chipRow(businessId: string, tag: ProjectedTag): string {
  const action = `/n/${esc(businessId)}/chips/${esc(tag.slug)}`;
  const target =
    tag.type === 'landing'
      ? ''
      : `<label class="field">${tag.type === 'redirect' ? 'Destino' : 'Enlace después de sumar el sello (opcional)'}
          <input type="url" name="destino" maxlength="2048" placeholder="https://…" ${tag.type === 'redirect' ? 'required' : ''} value="${esc(tag.targetUrl ?? '')}">
        </label>`;
  const pause = tag.pausedAt
    ? `<form method="post" action="${action}/pausa" class="stack"><input type="hidden" name="accion" value="reactivar">
        <p class="hint">Pausado el ${esc(fmt(tag.pausedAt))}: si el stand vuelve a estar en su sitio, reactívalo.</p>
        <button type="submit" class="btn">Reactivar chip</button></form>`
    : `<details class="lost"><summary>¿Se perdió o se dañó el stand?</summary>
        <form method="post" action="${action}/pausa" class="stack">
          <input type="hidden" name="accion" value="pausar">
          <p class="hint">El chip dejará de funcionar (mostrará "Enlace no disponible") para que nadie lo use fuera de tu local, y avisaremos a tu proveedor para reponerlo. Puedes reactivarlo cuando quieras.</p>
          <button type="submit" class="btn btn-danger">Sí, pausar este chip</button>
        </form></details>`;
  return `<li class="chip">
  <details>
    <summary>
      <span class="chip-no" title="Chip #${tag.number}">#${tag.number}</span>
      <span class="chip-main"><strong>${tag.label ? esc(tag.label) : `Chip #${tag.number}`}</strong><span>${chipLine(tag)}</span></span>
      ${status(tag)}
      <span class="chip-edit">Editar</span>
    </summary>
    <div class="chip-body">
      <form method="post" action="${action}" class="stack">
        <label class="field">Etiqueta (para reconocerlo)
          <input name="etiqueta" maxlength="80" placeholder="Caja, Mesa 3…" value="${esc(tag.label ?? '')}">
        </label>
        ${target}
        <button type="submit" class="btn btn-primary">Guardar</button>
      </form>
      ${pause}
    </div>
  </details>
</li>`;
}

export function chipsPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  tags: ProjectedTag[];
  loyalty: boolean;
  flash: FlashCode | null;
}): string {
  const { business } = input;
  const list =
    input.tags.length === 0
      ? '<p class="panel pad muted">Todavía no tienes chips asignados.</p>'
      : `<ul class="panel chips">${input.tags.map((t) => chipRow(business.id, t)).join('')}</ul>`;
  return page({
    title: 'Chips',
    session: input.session,
    business,
    current: 'chips',
    loyalty: input.loyalty,
    body: `${head('Chips', `${input.tags.length} ${input.tags.length === 1 ? 'stand' : 'stands'} · cambia a dónde lleva cada uno sin tocar el chip`)}
${flash(input.flash)}
${list}`,
  });
}

// ---------- Estadísticas ----------

export function statsPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  report: ReportRecord;
  stats: ReportStats;
  loyalty: ReportLoyalty | null;
  now: number;
}): string {
  return page({
    title: 'Estadísticas',
    session: input.session,
    business: input.business,
    current: 'estadisticas',
    loyalty: input.loyalty !== null,
    body: `${head('Estadísticas', `Cuántas personas usan tus chips y códigos QR · actualizado a las ${esc(timeOnly.format(new Date(input.now)))}`)}
${reportContent(input.report, input.stats, input.loyalty)}
${reportFootnote()}`,
    extraHead: `<style>${REPORT_STYLES}</style>`,
  });
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
    case 'staff.paired':
      return `Vinculó el móvil «${esc(show(after['label']))}» para validar canjes`;
    case 'qr.rotated':
      return 'Cambió la clave del QR del día (los QR anteriores dejaron de servir)';
    case 'staff.revoked':
      return `Desvinculó el móvil «${esc(show(before['label']))}»`;
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
  const today = dayKey.format(new Date());
  const yesterday = dayKey.format(new Date(Date.now() - 86_400_000));
  const groups = new Map<string, AuditView[]>();
  for (const e of input.entries) {
    const key = dayKey.format(new Date(e.ts));
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const label = (key: string, sample: number) =>
    key === today ? 'Hoy' : key === yesterday ? 'Ayer' : dayShort.format(new Date(sample));
  const body =
    input.entries.length === 0
      ? '<p class="panel pad muted">Todavía no hay cambios registrados.</p>'
      : [...groups.entries()]
          .map(
            ([key, list]) => `<section class="block">
  <h2 class="day-label">${esc(label(key, list[0]!.ts))}</h2>
  <ul class="panel pad rows events">${list
    .map(
      (e) =>
        `<li><span>${describe(e)}</span><time>${esc(timeOnly.format(new Date(e.ts)))}</time><span class="who">${actor(e)}</span></li>`,
    )
    .join('')}</ul>
</section>`,
          )
          .join('');
  return page({
    title: 'Actividad',
    session: input.session,
    business: input.business,
    current: 'actividad',
    loyalty: input.loyalty,
    body: `${head('Actividad', 'Quién cambió qué y cuándo. Se guarda un año.')}
<div class="narrow">${body}</div>`,
  });
}

// ---------- Personal ----------

export function staffPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  devices: StaffDeviceSummary[];
  loyalty: boolean;
  flash: FlashCode | null;
}): string {
  const base = `/n/${esc(input.business.id)}/personal`;
  const list =
    input.devices.length === 0
      ? '<li class="muted">Ningún móvil vinculado todavía.</li>'
      : input.devices
          .map(
            (d) => `<li class="device">
  <div class="device-main"><strong>${esc(d.label)}</strong>
  <span>Vinculado el ${esc(fmt(d.createdAt))}${d.createdBy ? ` por ${esc(d.createdBy)}` : ' por tu proveedor'} · ${
    d.lastUsedAt ? `último uso ${esc(fmt(d.lastUsedAt))}` : 'sin usar todavía'
  }</span></div>
  <details><summary>Desvincular</summary>
    <form method="post" action="${base}/${esc(d.id)}/revocar" class="stack">
      <p class="hint">Este móvil dejará de validar canjes al instante.</p>
      <button type="submit" class="btn btn-danger">Sí, desvincular</button>
    </form>
  </details>
</li>`,
          )
          .join('');
  return page({
    title: 'Personal',
    session: input.session,
    business: input.business,
    current: 'personal',
    loyalty: input.loyalty,
    body: `${head('Personal', 'Los móviles del local que validan los premios. Cada canje registra qué móvil lo validó.')}
${flash(input.flash)}
<div class="cols cols-even">
  <section class="block" aria-labelledby="devices-title">
    <div class="block-head"><h2 id="devices-title">Móviles vinculados</h2><span class="small muted num">${input.devices.length} de ${MAX_STAFF_DEVICES}</span></div>
    <ul class="panel pad rows devices">${list}</ul>
  </section>
  <section class="block" aria-labelledby="pair-title">
    <div class="block-head"><h2 id="pair-title">Vincular un móvil</h2></div>
    <form method="post" action="${base}" class="panel pad stack">
      <p>Ponle un nombre para reconocerlo. Te mostraremos un QR que se abre en ese móvil; sirve una sola vez y caduca en 15 minutos.</p>
      <label class="field">Nombre del móvil
        <input name="nombre" required maxlength="60" placeholder="Caja – María">
      </label>
      <button type="submit" class="btn btn-primary">Crear enlace de vinculación</button>
    </form>
  </section>
</div>`,
  });
}

export function pairingPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  label: string;
  pairing: PairingResponse;
  loyalty: boolean;
}): string {
  return page({
    title: 'Vincular móvil',
    session: input.session,
    business: input.business,
    current: 'personal',
    loyalty: input.loyalty,
    body: `${head(`Vincular «${esc(input.label)}»`, `Sirve una sola vez y caduca a las ${esc(timeOnly.format(new Date(input.pairing.expiresAt)))}`)}
<div class="cols cols-even">
  <div class="panel pad qr-stage">
    <div class="qr-plate pair-qr">${qrSvg(input.pairing.url)}</div>
    <p class="small mono break">${esc(input.pairing.url)}</p>
  </div>
  <section class="block">
    <ol class="steps">
      <li>Abre la cámara en el móvil que se queda en el local.</li>
      <li>Escanea este QR (o abre el enlace en ese móvil).</li>
      <li>Pulsa <strong>Vincular este móvil</strong>. Desde ese momento puede validar canjes.</li>
    </ol>
    <p class="hint">No lo compartas: quien lo abra podrá validar canjes.</p>
    <a class="btn" href="/n/${esc(input.business.id)}/personal">Listo</a>
  </section>
</div>`,
  });
}

// ---------- QR del día ----------

/** Segundos entre recargas de la pantalla del QR (la ventana es de 60 s; se aceptan 2). */
export const QR_REFRESH_SECONDS = 20;

export function qrPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  url: string | null;
  flash: FlashCode | null;
}): string {
  const id = esc(input.business.id);
  const body = input.url
    ? `<div class="cols">
  <section class="panel qr-stage stage" aria-labelledby="stage-title">
    <h2 id="stage-title">Escanea y suma tu sello</h2>
    <p class="muted">Abre la cámara del móvil y apunta al código.</p>
    <div class="qr-plate stage-qr">${qrSvg(input.url)}</div>
    <p class="small muted">Cambia solo cada minuto: una foto deja de servir enseguida.</p>
  </section>
  <div>
    <section class="block">
      <div class="block-head"><h2>En el mostrador</h2></div>
      <div class="panel pad stack">
        <p>Para dejarlo fijo, ábrelo en un móvil o tablet del personal: Personal → vincular → «Mostrar el QR del día».</p>
        <p class="hint">Esta pantalla abre tu sesión de dueño, con acceso a tus contactos: no la dejes a la vista.</p>
        <a class="btn" href="/n/${id}/personal">Ir a Personal</a>
      </div>
    </section>
    <section class="block">
      <div class="block-head"><h2>¿Circula una foto del QR?</h2></div>
      <div class="panel pad">
        <p>Cambia la clave: todos los QR anteriores dejan de servir al instante.</p>
        <details><summary>Cambiar la clave del QR</summary>
          <form method="post" action="/n/${id}/qr/rotar"><button type="submit" class="btn btn-danger">Sí, cambiar la clave</button></form>
        </details>
      </div>
    </section>
  </div>
</div>`
    : `<p class="notice notice-warn">El QR del día aún no está disponible. Avisa a tu proveedor.</p>`;
  return page({
    title: 'QR del día',
    session: input.session,
    business: input.business,
    current: 'qr',
    loyalty: true,
    body: `${head('QR del día', 'Tus clientes lo escanean para sumar su sello sin acercar el móvil al stand.')}
${flash(input.flash)}
${body}`,
    extraHead: input.url ? `<meta http-equiv="refresh" content="${QR_REFRESH_SECONDS}">` : '',
  });
}

/** Estilos propios de estas páginas (el armazón y los bloques comunes están en pages.ts). */
export const BUSINESS_STYLES = `
.panel details>summary{margin-top:8px;color:var(--accent-ink);text-decoration:underline;text-underline-offset:3px}
.panel details form{margin-top:12px}
.block>.btn{justify-self:start}
.chips{list-style:none;margin:0;padding:0}
.chip+.chip{border-top:1px solid var(--rule)}
.chip>details>summary{margin:0;color:inherit;text-decoration:none;display:grid;grid-template-columns:52px minmax(0,1fr) auto auto;align-items:center;gap:16px;padding:14px 20px;transition:background-color .15s}
.chip>details>summary:hover{background:var(--raised)}
.chip>details[open]>summary{background:var(--raised)}
.chip-edit{color:var(--accent-ink);font-weight:500;font-size:13px}
.chip>details[open] .chip-edit{visibility:hidden}
.chip-body{padding:16px 20px 20px 88px;display:grid;gap:16px;max-width:640px}
.lost summary{color:var(--accent-ink);font-size:13px;text-decoration:underline;text-underline-offset:3px}
.lost form{margin-top:12px}
.day-label{font-size:13px;color:var(--muted);font-weight:500;text-transform:capitalize}
.narrow{max-width:760px}
.devices>li{display:grid;gap:6px}
.device-main strong{display:block;font-weight:500}
.device-main span{display:block;font-size:13px;color:var(--muted)}
.devices details summary{color:var(--negative);font-size:13px}
.devices details form{margin-top:10px}
.qr-stage{display:grid;justify-items:center;text-align:center;gap:10px;padding:28px}
.stage h2{font-size:26px;letter-spacing:-.02em}
.stage-qr{width:min(100%,400px);border:3px solid var(--accent)}
.pair-qr{width:min(100%,300px)}
.break{word-break:break-all}
.steps{margin:0;padding-left:20px;display:grid;gap:10px;font-size:15px}
.cols .block+.block{margin-top:24px}
@media (max-width:900px){
  .sheet .block>.btn{justify-self:stretch;min-height:48px}
  .chip>details>summary{grid-template-columns:40px minmax(0,1fr) auto;padding:14px 16px}
  .chip-edit{display:none}
  .chip-body{padding:12px 16px 16px}
  .qr-stage{padding:20px}
}
`;
