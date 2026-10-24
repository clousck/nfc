import type { ReportRecord } from '@nfc/shared';
import { esc, TIME_ZONE } from './html.js';
import type { LoyaltySummary } from './loyalty/store.js';
import { REPORT_DAYS, type ReportStats } from './report.js';

export interface ReportLoyalty {
  visits: number;
  summary: LoyaltySummary;
  /** ¿Este móvil ya está activado para validar canjes de este negocio? */
  isValidator: boolean;
  color: { name: string; hex: string };
  token: string;
}

function loyaltySection(l: ReportLoyalty): string {
  const s = l.summary;
  const validator = l.isValidator
    ? `<p class="ok-line">✓ Este móvil valida canjes. Pídele al cliente su QR y escanéalo con la cámara.</p>
      <form method="get" action="/v" class="code-form">
        <label for="codigo">¿No se puede escanear? Escribe el código:</label>
        <div class="code-row"><input id="codigo" name="codigo" required placeholder="K7PQ-42XZ" autocomplete="off" autocapitalize="characters"><button type="submit">Validar</button></div>
      </form>`
    : `<p class="sub">Opcional: si quieres confirmar cada premio, activa el móvil del local y escanea el QR que muestra el cliente al canjear.</p>
      <form method="post" action="/r/${esc(l.token)}/validador"><button type="submit">Usar este móvil para validar canjes</button></form>`;
  return `<section class="card" id="validar">
    <h2>Programa de fidelidad</h2>
    <p class="sub">${l.visits} visitas = 1 premio · últimos 30 días</p>
    <div class="kpis">
      ${tile('Tarjetas activas', s.activeCards, `${n(s.cards)} en total`)}
      ${tile('Sellos', s.stamps30)}
      ${tile('Premios canjeados', s.redemptions30, s.validated30 > 0 ? `${n(s.validated30)} validados` : '')}
    </div>
    <div class="validator">
      <h3>Validar canjes</h3>
      <p class="day-color"><span class="swatch" style="background:${l.color.hex}"></span>Color de hoy: <strong>${esc(l.color.name)}</strong> · la pantalla de canje del cliente tiene este color y un reloj con segundos.</p>
      ${validator}
    </div>
  </section>`;
}

const dayLabel = new Intl.DateTimeFormat('es-EC', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const dayLong = new Intl.DateTimeFormat('es-EC', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const dateTime = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const timeOnly = new Intl.DateTimeFormat('es-EC', { timeZone: TIME_ZONE, timeStyle: 'short' });
const integer = new Intl.NumberFormat('es-EC');

const n = (value: number) => integer.format(value);
const scans = (value: number) => `${n(value)} ${value === 1 ? 'escaneo' : 'escaneos'}`;
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** Techo "redondo" para el eje, ajustado al máximo (25 → 30, 31 → 40) y con mitad entera. */
function niceMax(max: number): number {
  if (max <= 0) return 2;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const top = step * pow;
    if (top >= max && Number.isInteger(top / 2)) return top;
  }
  return 10 * pow;
}

function parseDay(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

interface Column {
  label: string;
  tip: string;
  value: number;
}

/** Columnas de una sola serie con tooltip CSS (hover y foco) y eje mínimo. */
function columnChart(title: string, columns: Column[], ticks: Array<[number, string]>): string {
  const top = niceMax(Math.max(...columns.map((c) => c.value)));
  const count = columns.length;
  const cols = columns
    .map((c, i) => {
      const edge = i < 3 ? ' edge-l' : i >= count - 3 ? ' edge-r' : '';
      const height = (c.value / top) * 100;
      return `<div class="col${edge}" tabindex="0" data-tip="${esc(c.tip)}" aria-label="${esc(c.tip)}"><span class="bar" style="height:${height.toFixed(2)}%"></span></div>`;
    })
    .join('');
  const xLabels = ticks
    .map(([i, label]) => {
      const left = ((i + 0.5) / count) * 100;
      return `<span style="left:${left.toFixed(2)}%">${esc(label)}</span>`;
    })
    .join('');
  return `<div class="chart" role="group" aria-label="${esc(title)}">
  <div class="plot" style="--cols:${count}">
    <span class="ytick ytick-top">${n(top)}</span>
    <span class="ytick ytick-mid">${n(top / 2)}</span>
    <div class="cols">${cols}</div>
  </div>
  <div class="xaxis">${xLabels}</div>
</div>`;
}

function dataTable(caption: string, header: [string, string], rows: Array<[string, number]>) {
  const body = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${n(v)}</td></tr>`).join('');
  return `<details class="table-view"><summary>Ver datos en tabla</summary>
<table><caption>${esc(caption)}</caption><thead><tr><th>${esc(header[0])}</th><th>${esc(header[1])}</th></tr></thead><tbody>${body}</tbody></table></details>`;
}

function tile(label: string, value: number, note = ''): string {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${n(value)}</div>${note ? `<div class="tile-note">${esc(note)}</div>` : ''}</div>`;
}

function osSplit(stats: ReportStats, total: number): string {
  const parts: Array<[string, number, string]> = [
    ['iPhone', stats.ios, 's1'],
    ['Android', stats.android, 's2'],
    ['Otros', stats.other, 's3'],
  ];
  const segments = parts
    .filter(([, value]) => value > 0)
    .map(
      ([label, value, slot]) =>
        `<span class="seg ${slot}" style="flex-grow:${value}" title="${esc(label)}: ${scans(value)}"></span>`,
    )
    .join('');
  const legend = parts
    .map(
      ([label, value, slot]) =>
        `<li><span class="key ${slot}"></span><span class="legend-label">${esc(label)}</span><strong>${pct(value, total)}%</strong><span class="muted">${n(value)}</span></li>`,
    )
    .join('');
  return `<div class="stack" role="img" aria-label="Teléfonos: ${parts.map(([l, v]) => `${l} ${pct(v, total)}%`).join(', ')}">${segments}</div><ul class="legend">${legend}</ul>`;
}

export function renderReportPage(
  report: ReportRecord,
  stats: ReportStats,
  now: number,
  loyalty: ReportLoyalty | null = null,
  /** Desde el portal: enlace de vuelta y sin el aviso de "enlace privado". */
  options: { backUrl?: string } = {},
): string {
  const today = stats.days[stats.days.length - 1]?.count ?? 0;
  const last7 = stats.days.slice(-7).reduce((sum, d) => sum + d.count, 0);
  const last30 = stats.days.reduce((sum, d) => sum + d.count, 0);
  const total = stats.nfc + stats.qr;

  const dayColumns: Column[] = stats.days.map((d) => ({
    label: dayLabel.format(parseDay(d.date)),
    tip: `${dayLong.format(parseDay(d.date))}: ${scans(d.count)}`,
    value: d.count,
  }));
  const dayTicks: Array<[number, string]> = [0, 10, 20, REPORT_DAYS - 1].map((i) => [
    i,
    i === REPORT_DAYS - 1 ? 'Hoy' : (dayColumns[i]?.label ?? ''),
  ]);
  const hourColumns: Column[] = stats.hours.map((count, h) => ({
    label: `${h} h`,
    tip: `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59: ${scans(count)}`,
    value: count,
  }));
  const hourTicks: Array<[number, string]> = [0, 6, 12, 18, 23].map((h) => [h, `${h} h`]);

  const busiestHour = stats.hours.indexOf(Math.max(...stats.hours));
  const tagRows = stats.tags
    .map(
      (t) =>
        `<tr><td><strong>#${t.number}</strong>${t.label ? ` <span class="muted">${esc(t.label)}</span>` : ''}</td><td class="num">${n(t.last30)}</td><td class="num">${n(t.total)}</td><td class="muted">${t.lastAt ? esc(dateTime.format(new Date(t.lastAt))) : '—'}</td></tr>`,
    )
    .join('');

  const body =
    report.tags.length === 0
      ? `<section class="card empty"><p>Todavía no hay chips asignados a este negocio.</p></section>`
      : `<section class="kpis">
    ${tile('Hoy', today)}
    ${tile('Últimos 7 días', last7)}
    ${tile('Últimos 30 días', last30)}
  </section>

  <section class="card">
    <h2>Escaneos por día</h2>
    <p class="sub">Últimos ${REPORT_DAYS} días</p>
    ${columnChart('Escaneos por día', dayColumns, dayTicks)}
    ${dataTable(
      'Escaneos por día',
      ['Día', 'Escaneos'],
      stats.days.map((d) => [dayLong.format(parseDay(d.date)), d.count]),
    )}
  </section>

  <section class="card">
    <h2>Por hora del día</h2>
    <p class="sub">${last30 > 0 ? `La hora con más movimiento es de ${busiestHour}:00 a ${busiestHour}:59` : 'Últimos 30 días'}</p>
    ${columnChart('Escaneos por hora del día', hourColumns, hourTicks)}
    ${dataTable(
      'Escaneos por hora del día',
      ['Hora', 'Escaneos'],
      stats.hours.map((count, h) => [`${h}:00–${h}:59`, count]),
    )}
  </section>

  <div class="grid-2">
    <section class="card">
      <h2>Cómo llegan</h2>
      <p class="sub">Últimos 30 días</p>
      <div class="kpis kpis-2">
        ${tile('Acercando el móvil (NFC)', stats.nfc, `${pct(stats.nfc, total)}%`)}
        ${tile('Escaneando el QR', stats.qr, `${pct(stats.qr, total)}%`)}
      </div>
    </section>
    <section class="card">
      <h2>Teléfonos</h2>
      <p class="sub">Últimos 30 días</p>
      ${total > 0 ? osSplit(stats, total) : '<p class="muted">Sin escaneos todavía.</p>'}
    </section>
  </div>

  <section class="card">
    <h2>Por punto</h2>
    <div class="table-wrap"><table class="tags">
      <thead><tr><th>Chip</th><th class="num">30 días</th><th class="num">Total</th><th>Último</th></tr></thead>
      <tbody>${tagRows}</tbody>
    </table></div>
  </section>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(report.name)} · Estadísticas</title>
<style>${STYLES}</style>
</head>
<body>
<main class="viz-root">
  <header class="page-head">
    ${options.backUrl ? `<p class="sub"><a href="${esc(options.backUrl)}">← Volver al portal</a></p>` : ''}
    <h1>${esc(report.name)}</h1>
    <p class="sub">Estadísticas de tus chips y códigos QR · actualizado a las ${esc(timeOnly.format(new Date(now)))}</p>
  </header>
  ${loyalty ? loyaltySection(loyalty) : ''}
  ${body}
  <footer class="foot">Las visitas automáticas (vistas previas de WhatsApp, buscadores…) no se cuentan.${options.backUrl ? '' : ' Este enlace es privado: compártelo solo con quien quieras.'}</footer>
</main>
</body>
</html>`;
}

// Tokens de la paleta de referencia (dataviz): chrome + categorías 1–3, claro y oscuro.
const STYLES = `
.viz-root{color-scheme:light;--page:#f9f9f7;--surface-1:#fcfcfb;--text-primary:#0b0b0b;--text-secondary:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--tip-bg:#0b0b0b;--tip-text:#f0efec}
@media (prefers-color-scheme:dark){.viz-root{color-scheme:dark;--page:#0d0d0d;--surface-1:#1a1a19;--text-primary:#f0efec;--text-secondary:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--tip-bg:#f0efec;--tip-text:#0b0b0b}}
*{box-sizing:border-box}
html,body{margin:0}
body{background:#f9f9f7}
@media (prefers-color-scheme:dark){body{background:#0d0d0d}}
.viz-root{max-width:880px;margin:0 auto;padding:20px 16px 48px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text-primary);line-height:1.45}
h1{font-size:1.5rem;margin:0 0 4px}
h2{font-size:1rem;margin:0}
.sub{margin:2px 0 14px;color:var(--text-secondary);font-size:.875rem}
.page-head .sub{margin-bottom:20px}
.muted{color:var(--muted)}
.card{background:var(--surface-1);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px}
.empty{text-align:center;color:var(--text-secondary)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.kpis-2{grid-template-columns:repeat(2,1fr);margin:0}
.tile{background:var(--surface-1);border:1px solid var(--border);border-radius:12px;padding:12px 14px}
.card .tile{border-radius:8px}
.tile-label{font-size:.8rem;color:var(--text-secondary)}
.tile-value{font-size:1.75rem;font-weight:600;line-height:1.2;margin-top:2px}
.tile-note{font-size:.8rem;color:var(--text-secondary)}
.grid-2{display:grid;gap:16px;grid-template-columns:1fr}
.grid-2 .card{margin-bottom:0}
.grid-2{margin-bottom:16px}
@media (min-width:640px){.grid-2{grid-template-columns:1fr 1fr}}
@media (max-width:420px){.kpis{gap:8px}.tile{padding:10px}.tile-value{font-size:1.4rem}}
.chart{margin-top:4px}
.plot{position:relative;height:160px;margin-left:28px;border-bottom:1px solid var(--axis);background:linear-gradient(to bottom,var(--grid) 0 1px,transparent 1px) 0 0/100% 50%}
.ytick{position:absolute;left:-28px;width:24px;text-align:right;font-size:.7rem;color:var(--muted);font-variant-numeric:tabular-nums;transform:translateY(-50%)}
.ytick-top{top:0}.ytick-mid{top:50%}
.cols{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--cols),1fr)}
.col{position:relative;display:flex;align-items:flex-end;justify-content:center;height:100%;outline:none;cursor:default}
.bar{display:block;width:calc(100% - 2px);max-width:24px;background:var(--series-1);border-radius:4px 4px 0 0}
.col:hover .bar,.col:focus-visible .bar{filter:brightness(1.15)}
.col:focus-visible{box-shadow:inset 0 0 0 2px var(--series-1);border-radius:4px}
.col::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);white-space:nowrap;background:var(--tip-bg);color:var(--tip-text);font-size:.75rem;font-weight:600;padding:4px 8px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .1s;z-index:2}
.col.edge-l::after{left:0;transform:none}
.col.edge-r::after{left:auto;right:0;transform:none}
.col:hover::after,.col:focus-visible::after{opacity:1}
.xaxis{position:relative;height:20px;margin-left:28px;font-size:.7rem;color:var(--muted)}
.xaxis span{position:absolute;top:4px;transform:translateX(-50%);white-space:nowrap}
.xaxis span:first-child{transform:none}
.xaxis span:last-child{transform:translateX(-100%)}
.table-view{margin-top:10px;font-size:.85rem}
.table-view summary{cursor:pointer;color:var(--text-secondary)}
table{border-collapse:collapse;width:100%;font-size:.875rem}
caption{text-align:left;color:var(--muted);font-size:.75rem;padding:6px 0}
th{text-align:left;font-weight:600;color:var(--text-secondary);font-size:.8rem;padding:6px 8px;border-bottom:1px solid var(--axis)}
td{padding:6px 8px;border-bottom:1px solid var(--grid)}
td:last-child,th:last-child{text-align:right}
.num,td:nth-child(2){font-variant-numeric:tabular-nums}
.tags td:last-child,.tags th:last-child{text-align:left}
.tags th,.tags .num,.tags td:last-child{white-space:nowrap}
.tags .num{text-align:right}
.table-wrap{overflow-x:auto}
.stack{display:flex;gap:2px;height:20px;border-radius:4px;overflow:hidden;margin:6px 0 12px}
.seg{display:block;min-width:4px}
.s1{background:var(--series-1)}.s2{background:var(--series-2)}.s3{background:var(--series-3)}
.legend{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:.875rem}
.legend li{display:grid;grid-template-columns:12px 1fr auto 3.5rem;align-items:center;gap:8px}
.legend .muted{text-align:right;font-variant-numeric:tabular-nums}
.key{width:12px;height:12px;border-radius:3px}
.validator{margin-top:8px;padding-top:12px;border-top:1px solid var(--grid)}
h3{font-size:.95rem;margin:0 0 6px}
.day-color{display:flex;align-items:center;gap:8px;font-size:.875rem;color:var(--text-secondary);margin:0 0 10px}
.swatch{flex:none;width:18px;height:18px;border-radius:50%}
.ok-line{font-weight:600;margin:0 0 10px}
form button{font:inherit;font-weight:600;padding:10px 14px;border-radius:10px;border:1px solid var(--series-1);background:var(--series-1);color:#fff;cursor:pointer}
.code-form label{display:block;font-size:.8rem;color:var(--text-secondary);margin-bottom:4px}
.code-row{display:flex;gap:8px}
.code-row input{flex:1;min-width:0;font:inherit;padding:10px;border-radius:10px;border:1px solid var(--axis);background:var(--surface-1);color:var(--text-primary);text-transform:uppercase;letter-spacing:.06em}
.foot{margin-top:24px;font-size:.8rem;color:var(--muted);text-align:center}
@media (forced-colors:active){.bar,.seg,.key{background:CanvasText}}
`;
