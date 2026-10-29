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
  return `<p class="${ok ? 'ok' : 'alert'}" role="status">${esc(text)}</p>`;
}

type NavKey = 'chips' | 'qr' | 'estadisticas' | 'personal' | 'actividad';

function nav(
  business: PortalBusiness,
  session: PortalSession,
  loyalty: boolean,
  current: NavKey,
): string {
  const base = `/n/${esc(business.id)}`;
  const items: [NavKey | null, string, string][] = [
    ['chips', base, 'Resumen'],
    ...(loyalty ? [['qr', `${base}/qr`, 'QR del día'] as [NavKey, string, string]] : []),
    ['estadisticas', `${base}/estadisticas`, 'Estadísticas'],
    ['personal', `${base}/personal`, 'Personal'],
    ['actividad', `${base}/actividad`, 'Actividad'],
    ...(loyalty
      ? [[null, `${base}/contactos.csv`, 'Contactos (CSV)'] as [null, string, string]]
      : []),
  ];
  const links = items
    .map(
      ([key, href, label]) =>
        `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');
  const back = session.businesses.length > 1 ? `<a class="back" href="/">Tus negocios</a>` : '';
  return `${back}<p class="biz">${esc(business.name)}</p><nav class="tabs" aria-label="Secciones">${links}</nav>`;
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

/** Dominio del destino, para leerlo de un vistazo ("instagram.com"). */
function host(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function chipRow(businessId: string, tag: ProjectedTag): string {
  const action = `/n/${esc(businessId)}/chips/${esc(tag.slug)}`;
  const target =
    tag.type === 'landing'
      ? ''
      : `<label>${tag.type === 'redirect' ? 'Destino' : 'Enlace después de sumar el sello (opcional)'}
      <input type="url" name="destino" maxlength="2048" placeholder="https://…" ${tag.type === 'redirect' ? 'required' : ''} value="${esc(tag.targetUrl ?? '')}">
    </label>`;
  const pause = tag.pausedAt
    ? `<form method="post" action="${action}/pausa" class="stack"><input type="hidden" name="accion" value="reactivar">
      <p class="small muted">Pausado el ${esc(fmt(tag.pausedAt))}. Si el stand vuelve a estar en su sitio, reactívalo.</p>
      <button type="submit" class="btn">Reactivar chip</button></form>`
    : `<details class="lost"><summary class="small">¿Se perdió o se dañó el stand?</summary>
      <form method="post" action="${action}/pausa" class="stack">
        <input type="hidden" name="accion" value="pausar">
        <p class="small muted">El chip dejará de funcionar (mostrará "Enlace no disponible") para que nadie lo use fuera de tu local, y avisaremos a tu proveedor para reponerlo. Puedes reactivarlo cuando quieras.</p>
        <button type="submit" class="btn">Sí, pausar este chip</button>
      </form></details>`;
  const dest = host(tag.targetUrl);
  return `<li class="chip">
  <details>
    <summary>
      <span class="chip-num">#${tag.number}</span>
      <span class="chip-name"><strong>${tag.label ? esc(tag.label) : `Chip #${tag.number}`}</strong>
        <span class="small muted">Chip #${tag.number} · ${TYPE_LABEL[tag.type]}${dest ? ` · ${esc(dest)}` : ''}</span></span>
      ${status(tag)}
      <span class="chip-edit">Editar</span>
    </summary>
    <div class="chip-body">
      <form method="post" action="${action}" class="stack">
        <label>Etiqueta (para reconocerlo)
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

function loyaltyOverview(
  businessId: string,
  visits: number | null,
  summary: LoyaltySummary | null,
): string {
  if (visits === null || !summary) return '';
  const id = esc(businessId);
  return `<section class="overview" aria-labelledby="ov-title">
  <h2 id="ov-title">Últimos 30 días</h2>
  <dl class="kpis">
    <div><dt>Sellos</dt><dd>${summary.stamps30}</dd><p>visitas registradas</p></div>
    <div><dt>Premios entregados</dt><dd>${summary.redemptions30}</dd><p>${summary.validated30} validados por tu personal</p></div>
    <div><dt>Tarjetas activas</dt><dd>${summary.activeCards}</dd><p>de ${summary.cards} creadas</p></div>
    <div class="kpi-reward"><dt>Premio</dt><dd>${visits} <span>visitas</span></dd>
      <details><summary>Cambiar</summary>
        <form method="post" action="/n/${id}/premio" class="stack">
          <label>Visitas para el premio
            <input type="number" name="visitas" required min="${LOYALTY_MIN_VISITS}" max="${LOYALTY_MAX_VISITS}" value="${visits}">
          </label>
          <p class="small muted">Las tarjetas que ya tienen sellos los conservan. El premio lo entregas tú en el local.</p>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </form>
      </details>
    </div>
  </dl>
  <a class="btn btn-primary qr-cta" href="/n/${id}/qr">Mostrar el QR del día</a>
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
      ? '<p class="muted empty">Todavía no tienes chips asignados.</p>'
      : `<ul class="chips">${input.tags.map((t) => chipRow(business.id, t)).join('')}</ul>`;
  return layout(
    business.name,
    `${nav(business, session, input.loyaltyVisits !== null, 'chips')}
<h1>${esc(business.name)}</h1>
${flash(input.flash)}
${paused}
${loyaltyOverview(business.id, input.loyaltyVisits, input.loyalty)}
<section class="panel" aria-labelledby="chips-title">
  <h2 id="chips-title">Tus chips <span class="muted">${input.tags.length}</span></h2>
  ${chips}
</section>`,
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
    `${nav(input.business, input.session, input.loyalty, 'actividad')}
<h1>Actividad</h1>
<section class="card">
  <p class="small muted">Cada cambio en la configuración de tu negocio queda registrado: quién lo hizo, qué cambió y cuándo. Se guarda un año.</p>
  ${rows}
</section>`,
    input.session,
  );
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
      ? '<p class="muted">Ningún móvil vinculado todavía.</p>'
      : `<ul class="plain">${input.devices
          .map(
            (d) => `<li>
  <div><strong>${esc(d.label)}</strong></div>
  <div class="small muted">Vinculado el ${esc(fmt(d.createdAt))}${d.createdBy ? ` por ${esc(d.createdBy)}` : ' por tu proveedor'} · ${
    d.lastUsedAt ? `último uso ${esc(fmt(d.lastUsedAt))}` : 'sin usar todavía'
  }</div>
  <details><summary class="small">Desvincular</summary>
    <form method="post" action="${base}/${esc(d.id)}/revocar" class="stack">
      <p class="small muted">Este móvil dejará de validar canjes al instante.</p>
      <button type="submit" class="btn">Sí, desvincular</button>
    </form>
  </details>
</li>`,
          )
          .join('')}</ul>`;
  return layout(
    `Personal · ${input.business.name}`,
    `${nav(input.business, input.session, input.loyalty, 'personal')}
<h1>Personal</h1>
${flash(input.flash)}
<section class="card">
  <h2>Móviles que validan canjes</h2>
  <p class="small muted">Cada móvil del local tiene su propia credencial: si se pierde o alguien deja de trabajar contigo, desvincula solo ese. Cada canje validado registra qué móvil lo hizo.</p>
  ${list}
</section>
<section class="card">
  <h2>Vincular un móvil</h2>
  <form method="post" action="${base}" class="stack">
    <label>Nombre del móvil
      <input name="nombre" required maxlength="60" placeholder="Caja – María">
    </label>
    <button type="submit" class="btn btn-primary">Crear enlace de vinculación</button>
  </form>
</section>`,
    input.session,
  );
}

export function pairingPage(input: {
  session: PortalSession;
  business: PortalBusiness;
  label: string;
  pairing: PairingResponse;
  loyalty: boolean;
}): string {
  return layout(
    `Vincular móvil · ${input.business.name}`,
    `${nav(input.business, input.session, input.loyalty, 'personal')}
<h1>Vincular «${esc(input.label)}»</h1>
<section class="card">
  <p>Con el móvil del local, escanea este QR con la cámara (o abre el enlace) y pulsa <strong>Vincular este móvil</strong>.</p>
  <div class="qr">${qrSvg(input.pairing.url)}</div>
  <p class="small"><code class="break">${esc(input.pairing.url)}</code></p>
  <p class="small muted">Sirve una sola vez y caduca a las ${esc(fmt(input.pairing.expiresAt))}. No lo compartas: quien lo abra podrá validar canjes.</p>
  <a class="btn" href="/n/${esc(input.business.id)}/personal">Listo</a>
</section>`,
    input.session,
  );
}

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
    ? `<section class="card qr-stage">
  <p>Deja esta pantalla en el mostrador. Tus clientes la escanean con la cámara del móvil y suman su sello del día.</p>
  <div class="qr qr-big">${qrSvg(input.url)}</div>
  <p class="small muted">El código cambia solo cada minuto, así que una foto deja de servir enseguida.</p>
  <p class="small muted">Para dejarlo fijo en el mostrador usa un móvil del personal (Personal → vincular → «Mostrar el QR del día»): esta pantalla abre tu sesión de dueño, con acceso a tus contactos.</p>
</section>
<section class="card">
  <h2>¿Alguien comparte una foto del QR?</h2>
  <p class="muted">Cambia la clave: todos los QR anteriores dejan de servir al instante.</p>
  <details><summary>Cambiar la clave del QR</summary>
    <form method="post" action="/n/${id}/qr/rotar"><button type="submit" class="btn btn-danger">Sí, cambiar la clave</button></form>
  </details>
</section>`
    : `<section class="card"><p class="alert">El QR del día aún no está disponible. Avisa a tu proveedor.</p></section>`;
  return layout(
    `QR del día · ${input.business.name}`,
    `${nav(input.business, input.session, true, 'qr')}
<h1>QR del día</h1>
${flash(input.flash)}
${body}`,
    input.session,
    input.url ? `<meta http-equiv="refresh" content="${QR_REFRESH_SECONDS}">` : '',
  );
}
