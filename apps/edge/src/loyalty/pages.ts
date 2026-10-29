import {
  formatRedemptionCode,
  LOYALTY_EXPIRY_DAYS,
  MAX_STAFF_DEVICES,
  PAIRING_PATH,
} from '@nfc/shared';
import qrcode from 'qrcode-generator';
import { esc, TIME_ZONE } from '../html.js';
import { THEME_CSS } from '../ui/theme.js';
import { SCANNER_STYLES, scannerHtml, scannerScript } from './scanner.js';

const dateTime = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** Iniciales del negocio para el sello: "Café Los Andes" → "CL". */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(de|del|la|las|el|los|y)$/i.test(w));
  const letters = (words.length > 1 ? [words[0], words[1]] : [words[0] ?? name])
    .map((w) => (w ?? '').charAt(0))
    .join('');
  return letters.toUpperCase() || '★';
}

export function firstName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Color del día: cambia cada día; el personal lo ve en su enlace de estadísticas. */
const DAY_COLORS = [
  { name: 'Azul', hex: '#2a78d6' },
  { name: 'Naranja', hex: '#eb6834' },
  { name: 'Verde', hex: '#1f9d55' },
  { name: 'Morado', hex: '#6250d6' },
  { name: 'Rosa', hex: '#d6407e' },
  { name: 'Turquesa', hex: '#138a8a' },
  { name: 'Rojo', hex: '#d03b3b' },
] as const;

export function colorOfDay(localDate: string): { name: string; hex: string } {
  const days = Math.floor(Date.parse(`${localDate}T00:00:00Z`) / 86_400_000);
  return DAY_COLORS[((days % 7) + 7) % 7]!;
}

function layout(title: string, body: string, extraHead = ''): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#fbf7f8">
<title>${esc(title)}</title>
<style>${STYLES}</style>
${extraHead}
</head>
<body>
<main class="wrap">${body}</main>
</body>
</html>`;
}

function footerLinks(businessId: string, withDelete: boolean): string {
  return `<nav class="foot">
  <a href="/l/privacidad/${esc(businessId)}">Privacidad</a>
  ${withDelete ? `<a href="/l/baja/${esc(businessId)}">Darme de baja</a>` : ''}
</nav>`;
}

// ---------- Alta ----------

export function signupPage(input: {
  businessId: string;
  businessName: string;
  visits: number;
  slug: string;
  source: 'nfc' | 'qr';
  error?: string;
  values?: { name?: string; phone?: string };
}): string {
  const { businessName: name } = input;
  const body = `
<section class="card brand">
  <div class="brand-head">
    <div class="seal">${esc(initials(name))}</div>
    <div>
      <p class="eyebrow">Tarjeta de fidelidad</p>
      <h1>${esc(name)}</h1>
    </div>
  </div>
  <p class="pitch">Completa <strong>${input.visits} visitas</strong> y reclama tu premio</p>
  ${stampGrid({ visits: input.visits, stamps: 0, initials: initials(name), animateIndex: null })}
</section>

<section class="card">
  <h2>Crea tu tarjeta</h2>
  <p class="muted">Solo la primera vez. Después, cada vez que acerques tu móvil al stand sumas un sello.</p>
  ${input.error ? `<p class="alert">${esc(input.error)}</p>` : ''}
  <form method="post" action="/l/${esc(input.slug)}/registro" class="form">
    <input type="hidden" name="fuente" value="${input.source}">
    <label>Tu nombre
      <input name="nombre" required minlength="2" maxlength="60" autocomplete="given-name" value="${esc(input.values?.name ?? '')}">
    </label>
    <label>Tu teléfono
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
    <button type="submit" class="btn btn-primary">Crear mi tarjeta${input.source === 'nfc' ? ' y sumar mi primer sello' : ''}</button>
  </form>
</section>`;
  return layout(`${name} · Tarjeta de fidelidad`, body);
}

// ---------- Tarjeta ----------

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
      : `Llevas <strong>${stamps} de ${visits}</strong>. Te ${remaining === 1 ? 'falta <strong>1 visita' : `faltan <strong>${remaining} visitas`}</strong> para tu premio.`;
  const animateIndex = input.message === 'added' || input.message === 'welcome' ? stamps - 1 : null;

  const body = `
<section class="card brand${ready ? ' complete' : ''}">
  <div class="brand-head">
    <div class="seal">${esc(initials(name))}</div>
    <div>
      <p class="eyebrow">Tarjeta de fidelidad</p>
      <h1>${esc(name)}</h1>
    </div>
  </div>
  <p class="headline">${headline}</p>
  <p class="pitch">${detail}</p>
  <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${visits}" aria-valuenow="${stamps}"><span style="width:${Math.round((Math.min(stamps, visits) / visits) * 100)}%"></span></div>
  ${stampGrid({ visits, stamps: Math.min(stamps, visits), initials: initials(name), animateIndex })}
  ${ready ? '<div class="confetti" aria-hidden="true">' + '<i></i>'.repeat(14) + '</div>' : ''}
</section>

${
  ready
    ? `<a class="btn btn-reward" href="/l/canjear/${esc(input.businessId)}">Canjear mi premio</a>`
    : ''
}
${
  input.pendingCode
    ? `<a class="btn" href="/l/canje/${esc(input.pendingCode)}">Ver el QR de mi último canje</a>`
    : ''
}
${input.continueUrl ? `<a class="btn btn-primary" href="${esc(input.continueUrl)}">Continuar</a>` : ''}

<p class="note">Suma 1 sello por día acercando tu móvil al stand. Si pasas ${LOYALTY_EXPIRY_DAYS} días sin venir, tu tarjeta vuelve a empezar.</p>
${footerLinks(input.businessId, true)}`;
  return layout(`${name} · Mi tarjeta`, body);
}

export function redeemConfirmPage(input: { businessId: string; businessName: string }): string {
  const body = `
<section class="card">
  <h1>¿Estás frente al cajero?</h1>
  <p>Al canjear, tu tarjeta vuelve a 0 y aparece un <strong>código QR único</strong> para que el local confirme tu premio.</p>
  <form method="post" action="/l/canjear/${esc(input.businessId)}">
    <button type="submit" class="btn btn-reward">Sí, canjear ahora</button>
  </form>
  <a class="btn" href="/l/tarjeta/${esc(input.businessId)}">Todavía no</a>
</section>`;
  return layout(`${input.businessName} · Canjear`, body);
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
<section class="card redeem" style="--day:${input.color.hex}">
  <p class="eyebrow">${esc(input.businessName)}</p>
  <h1 id="status">${validated ? '✓ Premio entregado' : 'Premio canjeado'}</h1>
  <div class="live">
    <span class="pulse" aria-hidden="true"></span>
    <span id="clock" class="clock">--:--:--</span>
  </div>
  <div class="qr ${validated ? 'done' : ''}">${qrSvg(input.validateUrl)}</div>
  <p class="code">Código <strong>${esc(formatRedemptionCode(input.code))}</strong></p>
  <p class="muted" id="hint">${
    validated
      ? `Confirmado por el local el ${esc(dateTime.format(new Date(input.validatedAt!)))}.`
      : 'Muéstrale esta pantalla al cajero. Si el local lo pide, escaneará el QR para confirmarlo.'
  }</p>
  <p class="small muted">Canjeado el ${esc(dateTime.format(new Date(input.createdAt)))}</p>
</section>
<a class="btn" href="/l/tarjeta/${esc(input.businessId)}">Volver a mi tarjeta</a>
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
        document.getElementById('status').textContent = '✓ Premio entregado';
        document.getElementById('hint').textContent = 'El local confirmó tu premio. ¡Gracias por tu visita!';
        document.querySelector('.qr').classList.add('done');
      }
    } catch {}
  }, 4000);`
  }
})();
</script>`;
  return layout(`${input.businessName} · Canje`, body);
}

// ---------- Validación (pantalla del personal) ----------

export type ValidationOutcome =
  | { kind: 'valid'; customerName: string | null; visits: number; createdAt: number }
  | { kind: 'already'; validatedAt: number; customerName: string | null }
  | { kind: 'invalid' }
  | { kind: 'not_staff' };

export function validationPage(businessName: string | null, outcome: ValidationOutcome): string {
  let body: string;
  switch (outcome.kind) {
    case 'valid':
      body = `<section class="card verdict ok">
  <div class="verdict-icon">✓</div>
  <h1>Canje válido</h1>
  <p class="big">${outcome.customerName ? esc(firstName(outcome.customerName)) : 'Cliente'} · ${outcome.visits} visitas</p>
  <p><strong>Entrega el premio.</strong></p>
  <p class="muted small">Canjeado el ${esc(dateTime.format(new Date(outcome.createdAt)))}</p>
</section>`;
      break;
    case 'already':
      body = `<section class="card verdict bad">
  <div class="verdict-icon">!</div>
  <h1>Este canje ya se usó</h1>
  <p class="big">Validado el ${esc(dateTime.format(new Date(outcome.validatedAt)))}</p>
  <p class="muted">No entregues el premio otra vez.</p>
</section>`;
      break;
    case 'invalid':
      body = `<section class="card verdict bad">
  <div class="verdict-icon">✗</div>
  <h1>Código no válido</h1>
  <p class="muted">Este código no existe o no es de ${esc(businessName ?? 'este local')}.</p>
</section>`;
      break;
    case 'not_staff':
      body = `<section class="card">
  <h1>Validación de canjes</h1>
  <p>Esta pantalla es para el personal del local.</p>
  <p class="muted">Si eres el cliente: muestra tu código QR al cajero.</p>
  <p class="muted">Si eres del local: este móvil aún no está vinculado. Pide al dueño que lo vincule desde el portal del negocio (Personal → Vincular dispositivo).</p>
</section>`;
      break;
  }
  if (outcome.kind !== 'not_staff') {
    body += `
<a class="btn btn-primary" href="/v?escanear=1">Escanear otro QR</a>
<a class="btn" href="/v">Escribir un código</a>`;
  }
  return layout('Validar canje', body);
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
<section class="card">
  <p class="eyebrow">${esc(input.businessName)} · ${esc(input.label)}</p>
  <h1>Validar canjes</h1>
  <p>Escanea el QR que muestra el cliente. Si no se puede, escribe el código:</p>
  ${input.error ? '<p class="alert">Ese código no es válido. Revísalo e inténtalo otra vez.</p>' : ''}
  ${scannerHtml()}
  <form method="get" action="/v" class="form">
    <label>Código
      <input name="codigo" required placeholder="K7PQ-42XZ" autocomplete="off" autocapitalize="characters">
    </label>
    <button type="submit" class="btn btn-primary">Validar</button>
  </form>
  <p class="muted small">Color de hoy: <strong>${esc(input.color.name)}</strong>. La pantalla de canje del cliente tiene este color y un reloj con segundos: una captura de pantalla no lo tiene.</p>
</section>
${scannerScript(input.nonce, input.autostart)}`;
  return layout('Validar canjes', body, `<style>${SCANNER_STYLES}</style>`);
}

export function pairingConfirmPage(input: {
  businessName: string;
  label: string;
  token: string;
}): string {
  const body = `
<section class="card">
  <h1>Vincular este móvil</h1>
  <p>Este móvil quedará como <strong>${esc(input.label)}</strong> para validar canjes de <strong>${esc(input.businessName)}</strong>.</p>
  <p class="muted small">Ábrelo en el móvil que se queda en el local. El dueño puede desvincularlo cuando quiera.</p>
  <form method="post" action="${PAIRING_PATH}/${esc(input.token)}" class="form">
    <button type="submit" class="btn btn-primary">Vincular este móvil</button>
  </form>
</section>`;
  return layout('Vincular móvil', body);
}

export function pairingInvalidPage(): string {
  return layout(
    'Enlace no válido',
    `<section class="card"><h1>Este enlace ya no sirve</h1>
<p>Caducó (dura 15 minutos) o ya se usó. Pide al dueño que genere otro desde el portal.</p></section>`,
  );
}

export function pairingTooManyPage(): string {
  return layout(
    'Demasiados móviles',
    `<section class="card"><h1>No se pudo vincular</h1>
<p>El negocio ya tiene el máximo de ${MAX_STAFF_DEVICES} móviles vinculados. El dueño debe desvincular uno en el portal y generar un enlace nuevo.</p></section>`,
  );
}

// ---------- Privacidad y baja ----------

export function privacyPage(businessName: string): string {
  const name = esc(businessName);
  const body = `
<section class="card prose">
  <h1>Privacidad · ${name}</h1>
  <p><strong>Qué guardamos:</strong> tu nombre, tu teléfono, tus sellos y la fecha de cada visita.</p>
  <p><strong>Para qué:</strong> llevar tu tarjeta de sellos en ${name}. Solo si lo aceptas, ${name} podrá contactarte con promociones.</p>
  <p><strong>Quién lo ve:</strong> ${name} y la plataforma que gestiona la tarjeta. No se vende ni se comparte con nadie más.</p>
  <p><strong>Cuánto tiempo:</strong> mientras tengas la tarjeta. Puedes borrarla cuando quieras con «Darme de baja» en tu tarjeta; se eliminan tu nombre, tu teléfono y tus sellos.</p>
  <p><strong>Tu móvil:</strong> lo reconocemos con una cookie técnica, necesaria para la tarjeta. No usamos cookies de publicidad ni de seguimiento.</p>
  <p class="muted small">Tratamiento según la Ley Orgánica de Protección de Datos Personales del Ecuador.</p>
</section>`;
  return layout(`Privacidad · ${businessName}`, body);
}

export function deleteConfirmPage(input: { businessId: string; businessName: string }): string {
  const body = `
<section class="card">
  <h1>¿Darte de baja?</h1>
  <p>Se borrarán tu nombre, tu teléfono y <strong>todos tus sellos</strong> en ${esc(input.businessName)}. No se puede deshacer.</p>
  <form method="post" action="/l/baja/${esc(input.businessId)}">
    <button type="submit" class="btn btn-danger">Sí, borrar mi tarjeta</button>
  </form>
  <a class="btn" href="/l/tarjeta/${esc(input.businessId)}">Cancelar</a>
</section>`;
  return layout('Darme de baja', body);
}

export function messagePage(title: string, text: string): string {
  return layout(title, `<section class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p></section>`);
}

const STYLES = `${THEME_CSS}
.wrap{max-width:460px;margin:0 auto;padding:20px 16px 40px;display:flex;flex-direction:column;gap:12px}
.brand{background:var(--surface);padding:22px 20px 20px}
.brand-head{display:flex;align-items:center;gap:14px}
.seal{flex:none;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:1.05rem;letter-spacing:.02em;color:var(--accent);background:var(--accent-soft);border:2px solid var(--accent)}
.headline{font-size:1.75rem;font-weight:700;letter-spacing:-.02em;line-height:1.15;margin:18px 0 0}
.pitch{margin:6px 0 16px;color:var(--muted)}
.pitch strong{color:var(--text)}
.progress{height:6px;border-radius:99px;background:var(--accent-track);overflow:hidden;margin-bottom:18px}
.progress span{display:block;height:100%;background:var(--accent);border-radius:99px;transition:width .6s cubic-bezier(.2,.8,.2,1)}
.stamps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:12px}
.slot{aspect-ratio:1;border-radius:50%;border:2px dashed var(--control);display:grid;place-items:center;position:relative;background:var(--ground)}
.slot-label{color:var(--muted);font-weight:600;font-size:.9375rem;font-variant-numeric:tabular-nums}
.slot.reward{border-color:var(--accent);background:var(--accent-soft)}
.slot.reward .slot-label{color:var(--accent-ink);font-size:.75rem}
.ink{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;transform:rotate(var(--r));color:var(--accent);border:3px solid currentColor;box-shadow:inset 0 0 0 4px var(--surface),inset 0 0 0 6px currentColor;background:var(--accent-soft);opacity:.94}
.ink-text{font-weight:800;font-size:1rem;letter-spacing:.03em}
.reward .ink{color:var(--accent-ink);background:var(--accent-track)}
.reward .ink-text{font-size:.75rem}
.slot.new .ink{animation:stamp .7s cubic-bezier(.2,1.4,.4,1) both}
@keyframes stamp{0%{transform:scale(2.4) rotate(calc(var(--r) - 25deg));opacity:0}55%{opacity:1;transform:scale(.88) rotate(var(--r))}100%{transform:scale(1) rotate(var(--r))}}
.complete{background:var(--accent-soft);border-color:var(--accent-track)}
.complete .headline{color:var(--accent-ink)}
.confetti{position:absolute;inset:0;pointer-events:none}
.confetti i{position:absolute;top:-10px;width:7px;height:12px;border-radius:2px;animation:fall 2.6s ease-in forwards}
.confetti i:nth-child(odd){background:var(--accent)}.confetti i:nth-child(even){background:var(--accent-ink)}.confetti i:nth-child(3n){background:var(--accent-track)}
${Array.from({ length: 14 }, (_, i) => `.confetti i:nth-child(${i + 1}){left:${(i * 7 + 3) % 100}%;animation-delay:${(i % 5) * 0.12}s;transform:rotate(${(i * 47) % 180}deg)}`).join('')}
@keyframes fall{to{top:110%;transform:rotate(540deg)}}
form .btn{margin-top:6px}
.card .btn+.btn,.card form+.btn{margin-top:10px}
.form{display:flex;flex-direction:column;gap:14px;margin-top:12px}
.form label{display:flex;flex-direction:column;gap:6px;font-weight:500;font-size:.9375rem}
.form input[type=text],.form input:not([type]),.form input[type=tel]{min-height:48px;padding:12px 14px;border:1px solid var(--control);border-radius:var(--radius-control);background:var(--surface);transition:border-color .15s}
.form input:focus{border-color:var(--accent);outline:none}
.check{flex-direction:row!important;align-items:flex-start;gap:12px!important;font-weight:400!important;font-size:.875rem!important}
.check input{width:20px;height:20px;margin-top:2px;flex:none;accent-color:var(--accent)}
.note{font-size:.8125rem;color:var(--muted);text-align:center;margin:4px 8px}
.foot{display:flex;justify-content:center;gap:20px;font-size:.8125rem;padding-top:8px}
.foot a{color:var(--muted)}
.redeem{text-align:center;border:3px solid var(--day);padding-top:28px}
.redeem::before{content:"";position:absolute;inset:0 0 auto;height:10px;background:var(--day)}
.live{display:inline-flex;align-items:center;gap:8px;margin:12px 0;padding:6px 14px;border-radius:99px;background:color-mix(in srgb,var(--day) 14%,var(--surface));font-weight:500}
.pulse{width:10px;height:10px;border-radius:50%;background:var(--day);animation:pulse 1s ease-in-out infinite}
@keyframes pulse{50%{transform:scale(1.6);opacity:.4}}
.clock{font-variant-numeric:tabular-nums;font-weight:700;font-size:2rem;letter-spacing:-.01em}
.qr{width:min(70vw,260px);margin:8px auto;padding:12px;background:#fff;border-radius:var(--radius);border:2px solid var(--day);animation:breathe 2.4s ease-in-out infinite}
.qr svg{display:block;width:100%;height:auto}
.qr.done{opacity:.25;animation:none}
@keyframes breathe{50%{transform:scale(1.025)}}
.code{font-size:1.25rem;font-weight:600;letter-spacing:.06em;font-variant-numeric:tabular-nums}
.verdict{text-align:center;padding:32px 20px}
.verdict-icon{width:96px;height:96px;margin:0 auto 14px;border-radius:50%;display:grid;place-items:center;font-size:3rem;font-weight:700;color:#fff;animation:pop .45s cubic-bezier(.2,1.4,.4,1) both}
@keyframes pop{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}
.verdict.ok{border:3px solid var(--positive);background:var(--positive-soft)}.verdict.ok .verdict-icon{background:var(--positive)}
.verdict.bad{border:3px solid var(--negative);background:var(--negative-soft)}.verdict.bad .verdict-icon{background:var(--negative)}
.big{font-size:1.25rem;font-weight:600}
.prose p{font-size:.9375rem}
.prose h2{margin-top:18px}
`;
