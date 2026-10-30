import {
  formatRedemptionCode,
  LOYALTY_EXPIRY_DAYS,
  MAX_STAFF_DEVICES,
  PAIRING_PATH,
} from '@nfc/shared';
import qrcode from 'qrcode-generator';
import { esc, TIME_ZONE } from '../html.js';
import { DEVICE_CSS, MARK_SVG, THEME_CSS } from '../ui/theme.js';
import { SCANNER_STYLES, scannerHtml, scannerScript } from './scanner.js';

// Pantallas de teléfono del cliente (tarjeta, alta, canje) y del personal (validador, QR del
// mostrador). Disposición en docs/UI.md §4: el pase de sellos con su talón, la acción principal
// fija abajo y el color del día como campo completo en el canje y en el validador.

const dateTime = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** Iniciales del negocio para el sello: "Café Los Andes" → "CA". */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(de|del|la|las|el|los|y)$/i.test(w));
  const letters = (words.length > 1 ? [words[0], words[1]] : [words[0] ?? name])
    .map((w) => (w ?? '').charAt(0))
    .join('');
  return letters.toUpperCase() || name.trim().charAt(0) || '?';
}

export function firstName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Color del día: cambia cada día; el personal lo ve en su validador. */
const DAY_COLORS = [
  { name: 'Azul', hex: '#2672ce' },
  { name: 'Naranja', hex: '#c94f1c' },
  { name: 'Verde', hex: '#17804a' },
  { name: 'Morado', hex: '#6250d6' },
  { name: 'Rosa', hex: '#cc3a76' },
  { name: 'Turquesa', hex: '#107c7c' },
  { name: 'Rojo', hex: '#d03b3b' },
] as const;

export function colorOfDay(localDate: string): { name: string; hex: string } {
  const days = Math.floor(Date.parse(`${localDate}T00:00:00Z`) / 86_400_000);
  return DAY_COLORS[((days % 7) + 7) % 7]!;
}

const ICONS = {
  check:
    '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross:
    '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  bang: '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 6v8"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
};

interface LayoutOptions {
  extraHead?: string;
  /** Clase extra del <body> (p. ej. una pantalla de color completo). */
  bodyClass?: string;
  /** Color del día para las pantallas que lo usan como campo. */
  day?: string;
  /** Columna ancha (QR del mostrador en una tablet). */
  wide?: boolean;
}

function layout(title: string, body: string, options: LayoutOptions = {}): string {
  const style = options.day ? ` style="--day:${esc(options.day)}"` : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#eef3f4">
<title>${esc(title)}</title>
<style>${THEME_CSS}${DEVICE_CSS}${STYLES}</style>
${options.extraHead ?? ''}
</head>
<body class="device${options.bodyClass ? ` ${options.bodyClass}` : ''}"${style}>
<div class="screen${options.wide ? ' screen-wide' : ''}">${body}</div>
</body>
</html>`;
}

/** Pantalla de estado: marca, titular, texto y, si hace falta, acciones fijas abajo. */
function statusPage(title: string, content: string, actions = ''): string {
  return layout(
    title,
    `<main class="status">
  <span class="mark">${MARK_SVG}<span>PengineXR</span></span>
  ${content}
</main>${actions ? `\n<div class="actionbar">${actions}</div>` : ''}`,
  );
}

function footerLinks(businessId: string, withDelete: boolean): string {
  return `<nav class="foot-links" aria-label="Tu tarjeta">
  <a href="/l/privacidad/${esc(businessId)}">Privacidad</a>
  ${withDelete ? `<a href="/l/baja/${esc(businessId)}">Darme de baja</a>` : ''}
</nav>`;
}

// ---------- El pase de sellos ----------

/** Columnas para que la cuadrícula de sellos quede pareja (6 → 3×2, 8 → 4×2, 10 → 5×2). */
function stampColumns(visits: number): number {
  if (visits <= 4) return visits;
  if (visits % 3 === 0 && visits <= 9) return 3;
  if (visits % 4 === 0 || visits === 7) return 4;
  return 5;
}

function stampGrid(input: {
  visits: number;
  stamps: number;
  initials: string;
  animateIndex: number | null;
}): string {
  const slots = Array.from({ length: input.visits }, (_, i) => {
    const filled = i < input.stamps;
    const isReward = i === input.visits - 1;
    // Giro "a mano" distinto en cada sello, estable entre visitas.
    const rotate = ((i * 37) % 31) - 15;
    const classes = [
      'slot',
      filled ? 'filled' : '',
      isReward ? 'reward' : '',
      i === input.animateIndex ? 'new' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const content = filled
      ? `<span class="ink" style="--r:${rotate}deg"><span class="ink-text">${esc(isReward ? 'Premio' : input.initials)}</span></span>`
      : `<span class="slot-label">${isReward ? 'Premio' : i + 1}</span>`;
    return `<li class="${classes}" aria-label="${filled ? 'Sello' : 'Pendiente'} ${i + 1}">${content}</li>`;
  }).join('');
  return `<ol class="stamps" style="--cols:${stampColumns(input.visits)}">${slots}</ol>`;
}

/** El pase: cabecera con el sello del negocio, la rejilla y el talón del premio. */
function pass(input: {
  name: string;
  owner: string;
  visits: number;
  stamps: number;
  stub: string;
  ready: boolean;
  animateIndex: number | null;
}): string {
  const shown = Math.min(input.stamps, input.visits);
  return `<section class="pass${input.ready ? ' is-ready' : ''}" aria-label="Tarjeta de sellos de ${esc(input.name)}">
  <div class="pass-head">
    <span class="seal" aria-hidden="true">${esc(initials(input.name))}</span>
    <div class="pass-id"><p class="pass-name">${esc(input.name)}</p><p class="pass-owner">${input.owner}</p></div>
    <p class="pass-count num" aria-label="${shown} de ${input.visits} sellos"><span>${shown}</span>/${input.visits}</p>
  </div>
  <div class="pass-body">${stampGrid({ visits: input.visits, stamps: shown, initials: initials(input.name), animateIndex: input.animateIndex })}</div>
  <p class="stub"><span class="stub-label">Premio</span><span class="stub-value">${input.stub}</span></p>
  ${input.ready ? '<div class="confetti" aria-hidden="true">' + '<i></i>'.repeat(14) + '</div>' : ''}
</section>`;
}

// ---------- Alta ----------

export function signupPage(input: {
  businessId: string;
  businessName: string;
  visits: number;
  slug: string;
  /** Destino del formulario si no es el del chip (alta desde el QR rotativo). */
  action?: string;
  source: 'nfc' | 'qr';
  error?: string;
  values?: { name?: string; phone?: string };
}): string {
  const { businessName: name } = input;
  const stamped = input.source === 'nfc' || input.action !== undefined;
  const body = `
<header class="topline"><span>Tarjeta de sellos</span><a href="/l/privacidad/${esc(input.businessId)}">Privacidad</a></header>
<main class="content">
  <h1 class="moment">Completa ${input.visits} visitas y llévate tu premio</h1>
  ${pass({ name, owner: 'Así será tu tarjeta', visits: input.visits, stamps: 0, stub: `a las ${input.visits} visitas`, ready: false, animateIndex: null })}
  <section class="panel pad signup" aria-labelledby="signup-title">
    <h2 id="signup-title">Crea tu tarjeta</h2>
    <p class="muted">Solo la primera vez. Después, en cada visita sumas un sello acercando tu móvil al stand o escaneando el QR del local.</p>
    ${input.error ? `<p class="notice notice-bad" role="alert">${esc(input.error)}</p>` : ''}
    <form method="post" action="${esc(input.action ?? `/l/${input.slug}/registro`)}" class="stack">
      <input type="hidden" name="fuente" value="${input.source}">
      <label class="field">Tu nombre
        <input name="nombre" required minlength="2" maxlength="60" autocomplete="given-name" value="${esc(input.values?.name ?? '')}">
      </label>
      <label class="field">Tu teléfono
        <input name="telefono" required type="tel" inputmode="tel" autocomplete="tel" placeholder="099 123 4567" value="${esc(input.values?.phone ?? '')}">
      </label>
      <label class="check">
        <input type="checkbox" name="acepto" required>
        <span>Acepto que <strong>${esc(name)}</strong> guarde mi nombre y teléfono para llevar mi tarjeta de sellos. <a href="/l/privacidad/${esc(input.businessId)}">Más información</a></span>
      </label>
      <label class="check">
        <input type="checkbox" name="promos">
        <span>Acepto que ${esc(name)} me contacte con promociones (opcional).</span>
      </label>
      <button type="submit" class="btn btn-primary btn-lg btn-block">Crear mi tarjeta${stamped ? ' y sumar mi primer sello' : ''}</button>
    </form>
  </section>
</main>`;
  return layout(`${name} · Tarjeta de fidelidad`, body);
}

// ---------- Tarjeta ----------

export type CardMessage = 'welcome' | 'added' | 'already_today' | 'reward_ready' | 'view';

export function cardPage(input: {
  businessId: string;
  businessName: string;
  customerName: string;
  visits: number;
  stamps: number;
  message: CardMessage;
  continueUrl: string | null;
  pendingCode: string | null;
}): string {
  const { visits, stamps, businessName: name } = input;
  const ready = stamps >= visits;
  const remaining = Math.max(0, visits - stamps);
  const who = esc(firstName(input.customerName));
  const missing = `${remaining === 1 ? 'falta <strong>1 visita' : `faltan <strong>${remaining} visitas`}</strong>`;
  const headline = ready
    ? `¡${who}, tu premio está listo!`
    : input.message === 'welcome'
      ? `¡Bienvenido/a, ${who}!`
      : input.message === 'added'
        ? '¡+1 sello!'
        : input.message === 'already_today'
          ? 'Ya sumaste el sello de hoy'
          : `Hola, ${who}`;
  const detail = ready
    ? 'Muéstrale esta pantalla al cajero y pulsa <strong>Canjear</strong> frente a él.'
    : input.message === 'already_today'
      ? `Llevas ${stamps} de ${visits}. ¡Vuelve mañana por el siguiente!`
      : `Llevas <strong>${stamps} de ${visits}</strong>. Te ${missing} para tu premio.`;
  const animateIndex = input.message === 'added' || input.message === 'welcome' ? stamps - 1 : null;

  const actions = [
    ready
      ? `<a class="btn btn-primary btn-lg btn-block" href="/l/canjear/${esc(input.businessId)}">Canjear mi premio</a>`
      : '',
    input.pendingCode
      ? `<a class="btn btn-lg btn-block" href="/l/canje/${esc(input.pendingCode)}">Ver el QR de mi último canje</a>`
      : '',
    input.continueUrl
      ? `<a class="btn btn-lg btn-block${ready ? '' : ' btn-primary'}" href="${esc(input.continueUrl)}">Continuar</a>`
      : '',
  ].filter(Boolean);

  const body = `
<header class="topline"><span>Tarjeta de sellos</span><span>${who ? `Hola, ${who}` : ''}</span></header>
<main class="content">
  <div class="moment-block${input.message === 'added' || input.message === 'welcome' ? ' is-new' : ''}" role="status">
    <h1 class="moment">${headline}</h1>
    <p class="moment-sub">${detail}</p>
  </div>
  ${pass({
    name,
    owner: `Tarjeta de ${who || 'cliente'}`,
    visits,
    stamps,
    stub: ready ? 'Listo para canjear' : `a las ${visits} visitas`,
    ready,
    animateIndex,
  })}
  <p class="note">Suma 1 sello por día acercando tu móvil al stand o escaneando el QR del local. Si pasas ${LOYALTY_EXPIRY_DAYS} días sin venir, tu tarjeta vuelve a empezar.</p>
  ${footerLinks(input.businessId, true)}
</main>
${actions.length > 0 ? `<div class="actionbar">${actions.join('\n')}</div>` : ''}`;
  return layout(`${name} · Mi tarjeta`, body);
}

export function redeemConfirmPage(input: { businessId: string; businessName: string }): string {
  return layout(
    `${input.businessName} · Canjear`,
    `<header class="topline"><span>${esc(input.businessName)}</span><span>Canjear premio</span></header>
<main class="status">
  <h1>¿Estás frente al cajero?</h1>
  <p>Al canjear, tu tarjeta vuelve a 0 y aparece un <strong>código QR único</strong> para que el local confirme tu premio.</p>
</main>
<div class="actionbar">
  <form method="post" action="/l/canjear/${esc(input.businessId)}">
    <button type="submit" class="btn btn-primary btn-lg btn-block">Sí, canjear ahora</button>
  </form>
  <a class="btn btn-lg btn-block" href="/l/tarjeta/${esc(input.businessId)}">Todavía no</a>
</div>`,
  );
}

// ---------- Canje (pantalla del cliente) ----------

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export function redemptionPage(input: {
  businessName: string;
  businessId: string;
  code: string;
  validateUrl: string;
  createdAt: number;
  validatedAt: number | null;
  color: { name: string; hex: string };
  nonce: string;
}): string {
  const validated = input.validatedAt !== null;
  const body = `
<main class="live">
  <p class="live-biz">${esc(input.businessName)}</p>
  <h1 id="status" class="live-status">${validated ? 'Premio entregado' : 'Premio canjeado'}</h1>
  <p class="live-clock"><span class="pulse" aria-hidden="true"></span><span id="clock" class="num">--:--:--</span></p>
  <section class="live-card">
    <div class="qr qr-plate${validated ? ' done' : ''}">${qrSvg(input.validateUrl)}</div>
    <p class="live-code">Código <span class="mono">${esc(formatRedemptionCode(input.code))}</span></p>
    <p class="muted" id="hint">${
      validated
        ? `Confirmado por el local el ${esc(dateTime.format(new Date(input.validatedAt!)))}`
        : 'Muéstrale esta pantalla al cajero. Si el local lo pide, escaneará el QR para confirmarlo.'
    }</p>
    <p class="small muted">Canjeado el ${esc(dateTime.format(new Date(input.createdAt)))} · color de hoy: ${esc(input.color.name)}</p>
  </section>
</main>
<div class="actionbar"><a class="btn btn-lg btn-block" href="/l/tarjeta/${esc(input.businessId)}">Volver a mi tarjeta</a></div>
<script nonce="${input.nonce}">
(() => {
  const clock = document.getElementById('clock');
  const fmt = new Intl.DateTimeFormat('es-EC', { timeZone: '${TIME_ZONE}', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const tick = () => { clock.textContent = fmt.format(new Date()); };
  tick(); setInterval(tick, 1000);
  ${
    validated
      ? ''
      : `const poll = setInterval(async () => {
    try {
      const r = await fetch(location.pathname + '/estado', { cache: 'no-store' });
      const s = await r.json();
      if (s.validated) {
        clearInterval(poll);
        document.getElementById('status').textContent = 'Premio entregado';
        document.getElementById('hint').textContent = 'El local confirmó tu premio. ¡Gracias por tu visita!';
        document.querySelector('.qr').classList.add('done');
      }
    } catch {}
  }, 4000);`
  }
})();
</script>`;
  return layout(`${input.businessName} · Canje`, body, {
    bodyClass: 'on-day',
    day: input.color.hex,
  });
}

// ---------- Validación (pantalla del personal) ----------

export type ValidationOutcome =
  | { kind: 'valid'; customerName: string | null; visits: number; createdAt: number }
  | { kind: 'already'; validatedAt: number; customerName: string | null }
  | { kind: 'invalid' }
  | { kind: 'not_staff' };

export function validationPage(businessName: string | null, outcome: ValidationOutcome): string {
  if (outcome.kind === 'not_staff') {
    return statusPage(
      'Validar canje',
      `<h1>Validación de canjes</h1>
  <p>Esta pantalla es para el personal del local.</p>
  <p class="muted">Si eres el cliente: muestra tu código QR al cajero.</p>
  <p class="muted">Si eres del local: este móvil aún no está vinculado. Pide al dueño que lo vincule desde el portal del negocio (Personal → Vincular un móvil).</p>`,
    );
  }
  let verdict: string;
  switch (outcome.kind) {
    case 'valid':
      verdict = `<main class="verdict verdict-ok">
  <span class="verdict-mark">${ICONS.check}</span>
  <h1>Canje válido</h1>
  <p class="verdict-big">${outcome.customerName ? esc(firstName(outcome.customerName)) : 'Cliente'} · ${outcome.visits} visitas</p>
  <p class="verdict-do">Entrega el premio.</p>
  <p class="verdict-meta">Canjeado el ${esc(dateTime.format(new Date(outcome.createdAt)))}</p>
</main>`;
      break;
    case 'already':
      verdict = `<main class="verdict verdict-bad">
  <span class="verdict-mark">${ICONS.bang}</span>
  <h1>Este canje ya se usó</h1>
  <p class="verdict-big">Validado el ${esc(dateTime.format(new Date(outcome.validatedAt)))}</p>
  <p class="verdict-do">No entregues el premio otra vez.</p>
</main>`;
      break;
    case 'invalid':
      verdict = `<main class="verdict verdict-bad">
  <span class="verdict-mark">${ICONS.cross}</span>
  <h1>Código no válido</h1>
  <p class="verdict-do">Este código no existe o no es de ${esc(businessName ?? 'este local')}.</p>
</main>`;
      break;
  }
  return layout(
    'Validar canje',
    `${verdict}
<div class="actionbar">
  <a class="btn btn-primary btn-lg btn-block" href="/v?escanear=1">Escanear otro QR</a>
  <a class="btn btn-lg btn-block" href="/v">Escribir un código</a>
</div>`,
  );
}

// ---------- Móvil del personal ----------

export function staffHomePage(input: {
  businessName: string;
  label: string;
  color: { name: string; hex: string };
  error: boolean;
  nonce: string;
  autostart: boolean;
}): string {
  const body = `
<header class="dayband">
  <p class="dayband-label">Color de hoy</p>
  <p class="dayband-name">${esc(input.color.name)}</p>
</header>
<main class="content">
  <div>
    <h1>Validar canjes</h1>
    <p class="muted">${esc(input.businessName)} · ${esc(input.label)}</p>
  </div>
  <p>Escanea el QR del cliente. Su pantalla debe ser de este color y tener un reloj con segundos que avanza: una captura no lo tiene.</p>
  ${input.error ? '<p class="notice notice-bad" role="alert">Ese código no es válido. Revísalo e inténtalo otra vez.</p>' : ''}
  ${scannerHtml()}
  <form method="get" action="/v" class="panel pad stack code-form">
    <label class="field">¿No se puede escanear? Escribe el código
      <input name="codigo" required placeholder="K7PQ-42XZ" autocomplete="off" autocapitalize="characters" class="mono">
    </label>
    <button type="submit" class="btn btn-block">Validar código</button>
  </form>
  <nav class="foot-links"><a href="/v/qr">Mostrar el QR del día</a></nav>
</main>
${scannerScript(input.nonce, input.autostart)}`;
  return layout('Validar canjes', body, {
    extraHead: `<style>${SCANNER_STYLES}</style>`,
    day: input.color.hex,
  });
}

/** El QR rotativo en el móvil o la tablet del local (personal vinculado). */
export function staffQrPage(input: { businessName: string; url: string | null }): string {
  if (!input.url) {
    return statusPage(
      'QR del día',
      `<h1>QR del día</h1><p>Aún no está disponible. Avisa a tu proveedor.</p>`,
      `<a class="btn btn-lg btn-block" href="/v">Volver a validar canjes</a>`,
    );
  }
  return layout(
    'QR del día',
    `<main class="counter">
  <h1>Escanea y suma tu sello</h1>
  <p class="counter-biz">Abre la cámara del móvil y apunta al código de ${esc(input.businessName)}.</p>
  <div class="qr-plate counter-qr">${qrSvg(input.url)}</div>
  <p class="muted">QR del día: cambia solo cada minuto.</p>
  <nav class="foot-links"><a href="/v">Volver a validar canjes</a></nav>
</main>`,
    { extraHead: '<meta http-equiv="refresh" content="20">', wide: true },
  );
}

export function pairingConfirmPage(input: {
  businessName: string;
  label: string;
  token: string;
}): string {
  return statusPage(
    'Vincular móvil',
    `<h1>Vincular este móvil</h1>
  <p>Este móvil quedará como <strong>${esc(input.label)}</strong> para validar canjes de <strong>${esc(input.businessName)}</strong>.</p>
  <p class="muted">Ábrelo en el móvil que se queda en el local. El dueño puede desvincularlo cuando quiera.</p>`,
    `<form method="post" action="${PAIRING_PATH}/${esc(input.token)}">
    <button type="submit" class="btn btn-primary btn-lg btn-block">Vincular este móvil</button>
  </form>`,
  );
}

export function pairingInvalidPage(): string {
  return statusPage(
    'Enlace no válido',
    `<h1>Este enlace ya no sirve</h1>
  <p>Caducó (dura 15 minutos) o ya se usó. Pide al dueño que genere otro desde el portal.</p>`,
  );
}

export function pairingTooManyPage(): string {
  return statusPage(
    'Demasiados móviles',
    `<h1>No se pudo vincular</h1>
  <p>El negocio ya tiene el máximo de ${MAX_STAFF_DEVICES} móviles vinculados. El dueño debe desvincular uno en el portal y generar un enlace nuevo.</p>`,
  );
}

// ---------- Privacidad y baja ----------

export function privacyPage(businessName: string): string {
  const name = esc(businessName);
  const rows: Array<[string, string]> = [
    ['Qué guardamos', 'Tu nombre, tu teléfono, tus sellos y la fecha de cada visita.'],
    [
      'Para qué',
      `Llevar tu tarjeta de sellos en ${name}. Solo si lo aceptas, ${name} podrá contactarte con promociones.`,
    ],
    [
      'Quién lo ve',
      `${name} y la plataforma que gestiona la tarjeta. No se vende ni se comparte con nadie más.`,
    ],
    [
      'Cuánto tiempo',
      'Mientras tengas la tarjeta. Puedes borrarla cuando quieras con «Darme de baja»: se eliminan tu nombre, tu teléfono y tus sellos.',
    ],
    [
      'Tu móvil',
      'Lo reconocemos con una cookie técnica, necesaria para la tarjeta. No usamos cookies de publicidad ni de seguimiento.',
    ],
  ];
  return layout(
    `Privacidad · ${businessName}`,
    `<header class="topline"><span>${name}</span><span>Privacidad</span></header>
<main class="content">
  <h1 class="moment">Tus datos en ${name}</h1>
  <dl class="panel privacy">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
  <p class="small muted">Tratamiento según la Ley Orgánica de Protección de Datos Personales del Ecuador.</p>
</main>`,
  );
}

export function deleteConfirmPage(input: { businessId: string; businessName: string }): string {
  return statusPage(
    'Darme de baja',
    `<h1>¿Darte de baja?</h1>
  <p>Se borrarán tu nombre, tu teléfono y <strong>todos tus sellos</strong> en ${esc(input.businessName)}. No se puede deshacer.</p>`,
    `<form method="post" action="/l/baja/${esc(input.businessId)}">
    <button type="submit" class="btn btn-danger btn-lg btn-block">Sí, borrar mi tarjeta</button>
  </form>
  <a class="btn btn-lg btn-block" href="/l/tarjeta/${esc(input.businessId)}">Cancelar</a>`,
  );
}

export function messagePage(title: string, text: string): string {
  return statusPage(title, `<h1>${esc(title)}</h1>\n  <p>${esc(text)}</p>`);
}

const STYLES = `
.moment{font-size:32px;line-height:1.1;letter-spacing:-.025em}
.moment-sub{margin-top:8px;font-size:17px;color:var(--text)}
.moment-block.is-new{animation:rise .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes rise{from{opacity:0;transform:translateY(12px)}}
.pass{position:relative;overflow:hidden;background:var(--sheet);border:1px solid var(--border);border-radius:18px}
.pass-head{display:flex;align-items:center;gap:12px;padding:16px 18px;background:var(--accent);color:#fff}
.seal{flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;border:2px solid rgba(255,255,255,.8);font-weight:600;font-size:15px;letter-spacing:.02em}
.pass-id{flex:1;min-width:0}
.pass-name{font-weight:600;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pass-owner{font-size:13px;color:#d9ecf0}
.pass-count{font-size:16px;color:#d9ecf0}
.pass-count span{font-size:34px;font-weight:600;letter-spacing:-.02em;color:#fff}
.pass-body{padding:20px 18px}
.stamps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:12px}
.slot{aspect-ratio:1;border-radius:50%;border:2px dashed var(--control);display:grid;place-items:center;position:relative;background:var(--raised)}
.slot-label{color:var(--muted);font-weight:500;font-size:15px;font-variant-numeric:tabular-nums}
.slot.reward{border-color:var(--accent);background:var(--accent-soft)}
.slot.reward .slot-label{color:var(--accent-ink);font-size:12px}
.ink{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;transform:rotate(var(--r));color:var(--accent);border:3px solid currentColor;box-shadow:inset 0 0 0 4px var(--sheet),inset 0 0 0 6px currentColor;background:var(--accent-soft)}
.ink-text{font-weight:700;font-size:15px;letter-spacing:.03em}
.reward .ink{color:var(--accent-ink);background:var(--accent-track)}
.reward .ink-text{font-size:11px}
.slot.new .ink{animation:stamp .7s cubic-bezier(.2,1.4,.4,1) both}
@keyframes stamp{0%{transform:scale(2.4) rotate(calc(var(--r) - 25deg));opacity:0}55%{opacity:1;transform:scale(.88) rotate(var(--r))}100%{transform:scale(1) rotate(var(--r))}}
.stub{position:relative;display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:0;padding:16px 20px;border-top:2px dashed var(--border)}
.stub::before,.stub::after{content:"";position:absolute;top:-12px;width:22px;height:22px;border-radius:50%;background:var(--frame);border:1px solid var(--border)}
.stub::before{left:-12px}.stub::after{right:-12px}
.stub-label{font-size:13px;color:var(--muted)}
.stub-value{font-weight:600}
.is-ready .stub{background:var(--accent-soft)}
.is-ready .stub-value{color:var(--accent-ink)}
.confetti{position:absolute;inset:0;pointer-events:none}
.confetti i{position:absolute;top:-10px;width:7px;height:12px;border-radius:2px;animation:fall 2.6s ease-in forwards}
.confetti i:nth-child(odd){background:var(--accent)}.confetti i:nth-child(even){background:#f2b33d}.confetti i:nth-child(3n){background:var(--accent-track)}
${Array.from({ length: 14 }, (_, i) => `.confetti i:nth-child(${i + 1}){left:${(i * 7 + 3) % 100}%;animation-delay:${(i % 5) * 0.12}s;transform:rotate(${(i * 47) % 180}deg)}`).join('')}
@keyframes fall{to{top:110%;transform:rotate(540deg)}}
.note{font-size:15px;color:#2f3537}
.signup h2{font-size:18px;margin-bottom:6px}
.signup .stack{margin-top:16px}
.privacy{margin:0;padding:20px;display:grid;gap:18px}
.privacy dt{font-weight:600;font-size:14px}
.privacy dd{margin:4px 0 0;font-size:16px}
.on-day .screen{background:var(--day)}
.live{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;padding:28px 20px 24px;color:#fff}
.live-biz{font-size:20px;font-weight:600}
.live-status{font-size:34px;letter-spacing:-.02em}
.live-clock{display:flex;align-items:center;gap:12px;margin:8px 0 16px;font-size:46px;font-weight:600;letter-spacing:-.01em;line-height:1}
.pulse{width:14px;height:14px;border-radius:50%;background:#fff;animation:pulse 1s ease-in-out infinite}
@keyframes pulse{50%{transform:scale(1.6);opacity:.35}}
.live-card{width:100%;display:grid;gap:10px;justify-items:center;padding:20px;background:var(--sheet);color:var(--text);border-radius:18px}
.live-card .qr{width:min(64vw,240px);border:0;padding:0}
.qr.done{opacity:.2}
.live-code{font-size:18px}
.live-code .mono{font-size:20px;letter-spacing:.04em}
.verdict{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:10px;padding:48px 28px;color:#fff}
.verdict-ok{background:var(--positive)}
.verdict-bad{background:var(--negative)}
.verdict h1{font-size:40px;line-height:1.05;letter-spacing:-.025em}
.verdict-mark{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;background:#fff;margin-bottom:12px;animation:pop .45s cubic-bezier(.2,1.4,.4,1) both}
.verdict-ok .verdict-mark{color:var(--positive)}
.verdict-bad .verdict-mark{color:var(--negative)}
@keyframes pop{from{transform:scale(.4);opacity:0}}
.verdict-big{font-size:22px;font-weight:600}
.verdict-do{font-size:18px}
.verdict-meta{font-size:15px;opacity:.9}
.dayband{background:var(--day);color:#fff;padding:20px 20px 18px}
.dayband-label{font-size:19px;font-weight:600}
.dayband-name{font-size:36px;font-weight:600;line-height:1.1;letter-spacing:-.02em}
.code-form .mono{font-size:18px;letter-spacing:.06em;text-transform:uppercase}
.screen-wide{max-width:760px}
.counter{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;padding:32px 20px}
.counter-biz{font-size:17px}
.counter h1{font-size:32px;letter-spacing:-.02em}
.counter-qr{width:min(84vw,62vh,520px);border:3px solid var(--accent)}
`;
