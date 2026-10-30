import type { ReportRecord } from '@nfc/shared';
import { esc, TIME_ZONE } from './html.js';
import type { LoyaltySummary } from './loyalty/store.js';
import { REPORT_DAYS, type ReportStats } from './report.js';
import { MARK_SVG, THEME_CSS } from './ui/theme.js';

// Estadísticas de un negocio (docs/UI.md §4). `reportContent` es el informe en sí; lo usan el
// enlace privado /r/<token> (con su propio armazón, `renderReportPage`) y el portal (dentro de su
// hoja, con la navegación). Gráficos en HTML y CSS, sin JavaScript, con tabla accesible.

export interface ReportLoyalty {
  visits: number;
  summary: LoyaltySummary;
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
function columnChart(
  title: string,
  columns: Column[],
  ticks: Array<[number, string]>,
  highlight: number | null = null,
): string {
  const top = niceMax(Math.max(...columns.map((c) => c.value)));
  const count = columns.length;
  const cols = columns
    .map((c, i) => {
      const edge = i < 3 ? ' edge-l' : i >= count - 3 ? ' edge-r' : '';
      const mark = i === highlight ? ' is-mark' : '';
      const height = (c.value / top) * 100;
      return `<div class="plot-col${edge}${mark}" tabindex="0" data-tip="${esc(c.tip)}" aria-label="${esc(c.tip)}"><span class="bar" style="height:${height.toFixed(2)}%"></span></div>`;
    })
    .join('');
  const xLabels = ticks
    .map(([i, label]) => {
      const left = ((i + 0.5) / count) * 100;
      return `<span style="left:${left.toFixed(2)}%">${esc(label)}</span>`;
    })
    .join('');
  return `<div class="chart" role="group" aria-label="${esc(title)}">
  <div class="plot">
    <span class="gl gl-top"></span><span class="gl gl-mid"></span>
    <span class="ytick ytick-top">${n(top)}</span>
    <span class="ytick ytick-mid">${n(top / 2)}</span>
    <div class="plot-cols" style="--cols:${count}">${cols}</div>
  </div>
  <div class="xaxis">${xLabels}</div>
</div>`;
}

function dataTable(caption: string, header: [string, string], rows: Array<[string, number]>) {
  const body = rows
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${n(v)}</td></tr>`)
    .join('');
  return `<details class="table-view"><summary>Ver datos en tabla</summary>
<table class="r-table"><caption>${esc(caption)}</caption><thead><tr><th>${esc(header[0])}</th><th class="num">${esc(header[1])}</th></tr></thead><tbody>${body}</tbody></table></details>`;
}

/** Partes de un total en una barra partida con su leyenda (un solo tono y sus tintes). */
function split(label: string, parts: Array<[string, number]>, total: number): string {
  const slots = ['s1', 's2', 's3'];
  const segments = parts
    .map(([name, value], i) =>
      value > 0
        ? `<span class="seg ${slots[i]}" style="flex-grow:${value}" title="${esc(name)}: ${scans(value)}"></span>`
        : '',
    )
    .join('');
  const legend = parts
    .map(
      ([name, value], i) =>
        `<li><span class="key ${slots[i]}"></span><span>${esc(name)}</span><strong class="num">${pct(value, total)}%</strong><span class="muted num">${n(value)}</span></li>`,
    )
    .join('');
  return `<div class="split-block"><p class="split-label">${esc(label)}</p>
<div class="split" role="img" aria-label="${esc(label)}: ${parts.map(([l, v]) => `${l} ${pct(v, total)}%`).join(', ')}">${segments}</div>
<ul class="legend">${legend}</ul></div>`;
}

function loyaltyPanel(l: ReportLoyalty): string {
  const s = l.summary;
  return `<section class="panel pad r-block" aria-labelledby="r-loyalty">
  <h2 id="r-loyalty">Programa de fidelidad</h2>
  <p class="sub">${l.visits} visitas = 1 premio · últimos 30 días</p>
  <dl class="r-figs">
    <div><dt>Tarjetas activas</dt><dd class="num">${n(s.activeCards)}</dd><p>de ${n(s.cards)} en total</p></div>
    <div><dt>Sellos</dt><dd class="num">${n(s.stamps30)}</dd><p>visitas con sello</p></div>
    <div><dt>Premios canjeados</dt><dd class="num">${n(s.redemptions30)}</dd><p>${n(s.validated30)} ${s.validated30 === 1 ? 'validado' : 'validados'}</p></div>
  </dl>
  <p class="hint">Para validar canjes, vincula el móvil de caja desde el portal de negocios (Personal).</p>
</section>`;
}

/** El informe sin armazón: cifra principal, gráficos, origen de las visitas y tabla por chip. */
export function reportContent(
  report: ReportRecord,
  stats: ReportStats,
  loyalty: ReportLoyalty | null = null,
): string {
  if (report.tags.length === 0) {
    return `<section class="panel pad r-empty"><h2>Todavía no hay chips</h2><p class="muted">Cuando tu proveedor te asigne un chip, aquí verás cuántas personas lo usan.</p></section>
${loyalty ? `<div class="r-cols">${loyaltyPanel(loyalty)}</div>` : ''}`;
  }
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
        `<tr><td><span class="mono">#${t.number}</span>${t.label ? ` <span class="muted">${esc(t.label)}</span>` : ''}</td><td class="num">${n(t.last30)}</td><td class="num">${n(t.total)}</td><td class="num muted">${t.lastAt ? esc(dateTime.format(new Date(t.lastAt))) : '—'}</td></tr>`,
    )
    .join('');

  return `<section class="panel pad lead" aria-labelledby="r-days">
  <div class="lead-head">
    <div><p class="lead-label">Últimos ${REPORT_DAYS} días</p><p class="lead-n num">${n(last30)}<small>${last30 === 1 ? 'escaneo' : 'escaneos'}</small></p></div>
    <dl class="lead-side">
      <div><dt>Hoy</dt><dd class="num">${n(today)}</dd></div>
      <div><dt>Últimos 7 días</dt><dd class="num">${n(last7)}</dd></div>
    </dl>
  </div>
  <h2 id="r-days" class="chart-title">Escaneos por día</h2>
  ${columnChart('Escaneos por día', dayColumns, dayTicks, dayColumns.length - 1)}
  ${dataTable(
    'Escaneos por día',
    ['Día', 'Escaneos'],
    stats.days.map((d) => [dayLong.format(parseDay(d.date)), d.count]),
  )}
</section>

<div class="r-cols">
  <section class="panel pad r-block" aria-labelledby="r-hours">
    <h2 id="r-hours">Por hora del día</h2>
    <p class="sub">${last30 > 0 ? `Más movimiento de ${busiestHour}:00 a ${busiestHour}:59` : `Últimos ${REPORT_DAYS} días`}</p>
    ${columnChart('Escaneos por hora del día', hourColumns, hourTicks, last30 > 0 ? busiestHour : null)}
    ${dataTable(
      'Escaneos por hora del día',
      ['Hora', 'Escaneos'],
      stats.hours.map((count, h) => [`${h}:00–${h}:59`, count]),
    )}
  </section>
  <section class="panel pad r-block" aria-labelledby="r-how">
    <h2 id="r-how">Cómo llegan</h2>
    <p class="sub">Últimos ${REPORT_DAYS} días</p>
    ${
      total > 0
        ? `${split(
            'Cómo abren el enlace',
            [
              ['Acercando el móvil (NFC)', stats.nfc],
              ['Escaneando el QR', stats.qr],
            ],
            total,
          )}
    ${split(
      'Con qué teléfono',
      [
        ['iPhone', stats.ios],
        ['Android', stats.android],
        ['Otros', stats.other],
      ],
      total,
    )}`
        : '<p class="muted">Sin escaneos todavía.</p>'
    }
  </section>
</div>

<div class="r-cols">
  <section class="panel pad r-block" aria-labelledby="r-tags">
    <h2 id="r-tags">Por chip</h2>
    <p class="sub">Escaneos de cada stand</p>
    <div class="table-wrap"><table class="r-table">
      <thead><tr><th>Chip</th><th class="num">30 días</th><th class="num">Total</th><th class="num">Último</th></tr></thead>
      <tbody>${tagRows}</tbody>
    </table></div>
  </section>
  ${loyalty ? loyaltyPanel(loyalty) : ''}
</div>`;
}

const BOTS_NOTE =
  'Las visitas automáticas (vistas previas de WhatsApp, buscadores…) no se cuentan.';

/** El enlace privado de estadísticas: su propio armazón, sin barra lateral. */
export function renderReportPage(
  report: ReportRecord,
  stats: ReportStats,
  now: number,
  loyalty: ReportLoyalty | null = null,
): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#eef3f4">
<title>${esc(report.name)} · Estadísticas</title>
<style>${THEME_CSS}${REPORT_SHELL}${REPORT_STYLES}</style>
</head>
<body class="report">
<header class="r-top">
  <span class="mark">${MARK_SVG}<span>PengineXR <small>Estadísticas</small></span></span>
  <span class="small muted">Actualizado a las ${esc(timeOnly.format(new Date(now)))}</span>
</header>
<main class="r-sheet">
  <div class="r-title">
    <h1>${esc(report.name)}</h1>
    <p class="sub">Cuántas personas usan tus chips y códigos QR</p>
  </div>
  ${reportContent(report, stats, loyalty)}
  <p class="r-foot">${BOTS_NOTE} Este enlace es privado: compártelo solo con quien quieras.</p>
</main>
</body>
</html>`;
}

export function reportFootnote(): string {
  return `<p class="r-foot">${BOTS_NOTE}</p>`;
}

const REPORT_SHELL = `
body.report{font-size:14px}
.r-top{max-width:1136px;margin:0 auto;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px}
.r-sheet{max-width:1136px;margin:0 auto 40px;background:var(--sheet);border:1px solid var(--border);border-radius:var(--radius-sheet);padding:32px}
.r-title{margin-bottom:24px}
.r-title h1{font-size:24px}
@media (max-width:900px){.r-top{padding:14px 16px}.r-sheet{margin:0;border-radius:0;border-left:0;border-right:0;padding:20px 16px}}
`;

export const REPORT_STYLES = `
.sub{font-size:13px;color:var(--muted);margin:2px 0 14px}
.lead{display:grid;gap:4px}
.lead-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;margin-bottom:12px}
.lead-label{font-size:13px;color:var(--muted)}
.lead-n{font-size:40px;font-weight:500;letter-spacing:-.02em;line-height:1.05}
.lead-n small{font-size:16px;font-weight:400;color:var(--muted);margin-left:6px;letter-spacing:0}
.lead-side{display:flex;gap:32px;margin:0}
.lead-side dt{font-size:13px;color:var(--muted)}
.lead-side dd{margin:2px 0 0;font-size:22px}
.chart-title{font-size:16px;margin-bottom:12px}
.r-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start;margin-top:24px}
.r-block h2{font-size:16px}
.chart{margin-top:4px}
.plot{position:relative;height:168px;margin-left:32px;border-bottom:1px solid #c9d1d4}
.gl{position:absolute;left:0;right:0;border-top:1px dashed var(--border)}
.gl-top{top:0}.gl-mid{top:50%}
.ytick{position:absolute;left:-32px;width:26px;text-align:right;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;transform:translateY(-50%)}
.ytick-top{top:0}.ytick-mid{top:50%}
.plot-cols{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--cols),1fr)}
.plot-col{position:relative;display:flex;align-items:flex-end;justify-content:center;height:100%;outline:none;cursor:default}
.bar{display:block;width:calc(100% - 3px);max-width:22px;background:var(--accent-track);border-radius:3px 3px 0 0;transition:background-color .15s}
.plot-col.is-mark .bar{background:var(--accent)}
.plot-col:hover .bar,.plot-col:focus-visible .bar{background:var(--accent-ink)}
.plot-col:focus-visible{box-shadow:inset 0 0 0 2px var(--accent);border-radius:4px}
.plot-col::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);white-space:nowrap;background:#131416;color:#fff;font-size:12px;font-weight:500;padding:4px 8px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .1s;z-index:2}
.plot-col.edge-l::after{left:0;transform:none}
.plot-col.edge-r::after{left:auto;right:0;transform:none}
.plot-col:hover::after,.plot-col:focus-visible::after{opacity:1}
.xaxis{position:relative;height:20px;margin-left:32px;font-size:12px;color:var(--muted)}
.xaxis span{position:absolute;top:4px;transform:translateX(-50%);white-space:nowrap}
.xaxis span:first-child{transform:none}
.xaxis span:last-child{transform:translateX(-100%)}
.table-view{margin-top:12px;font-size:13px}
.table-view summary{color:var(--accent-ink);text-decoration:underline;text-underline-offset:3px}
.r-table{border-collapse:collapse;width:100%;font-size:14px}
.r-table caption{text-align:left;color:var(--muted);font-size:12px;padding:6px 0}
.r-table th{text-align:left;font-weight:400;color:var(--muted);font-size:12px;padding:8px 8px 8px 0}
.r-table td{padding:10px 8px 10px 0;border-top:1px solid var(--rule)}
.r-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.r-table th:last-child,.r-table td:last-child{padding-right:0}
.table-wrap{overflow-x:auto}
.split-block+.split-block{margin-top:20px}
.split-label{font-size:13px;font-weight:500}
.split{display:flex;gap:2px;height:14px;border-radius:4px;overflow:hidden;margin:8px 0 10px}
.seg{display:block;min-width:4px}
.s1{background:var(--accent)}.s2{background:#7eaab5}.s3{background:#c9d4d7}
.legend{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:14px}
.legend li{display:grid;grid-template-columns:12px 1fr auto 3.5rem;align-items:center;gap:8px}
.legend .muted{text-align:right}
.key{width:12px;height:12px;border-radius:3px}
.r-figs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0 0 14px}
.r-figs>div{padding:0 16px;border-left:1px solid var(--border)}
.r-figs>div:first-child{padding-left:0;border-left:0}
.r-figs dt{font-size:13px;color:var(--muted)}
.r-figs dd{margin:4px 0 2px;font-size:26px}
.r-figs p{font-size:12px;color:var(--muted)}
.r-foot{margin-top:24px;font-size:13px;color:var(--muted)}
@media (max-width:900px){.r-cols{grid-template-columns:1fr}.lead-n{font-size:34px}.r-figs dd{font-size:22px}}
@media (forced-colors:active){.bar,.seg,.key{background:CanvasText}}
`;
