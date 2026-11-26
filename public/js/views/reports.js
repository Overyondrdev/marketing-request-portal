// Reports for the marketing team: volume, speed, quality and workload over a date range (by submission date),
// plus a snapshot of open work right now. Charts are inline SVG with a table view for every one.
// Chart colours were checked with the dataviz palette validator (light surface #FFFFFF):
//   submitted #3D5A9E, completed #5E8C2A — lightness band, chroma, CVD and contrast all pass.

import { api } from '../lib/api.js';
import { isMarketing } from '../lib/store.js';
import { html, raw, icon, empty, spinner, setTitle, nameOf, fmtDate, statusBadge, person, todayYmd, esc } from '../lib/ui.js';
import { STATUSES } from '../shared/workflow.js';

const SERIES = { submitted: { label: 'Submitted', color: '#3D5A9E' }, completed: { label: 'Completed', color: '#5E8C2A' } };
const STATUS_FILL = {
  pending_approval: '#E8C766', needs_info: '#E89B5C', rejected: '#D9776B', approved: '#9DAE7E', in_progress: '#4F6B35',
  in_review: '#C6D97A', on_hold: '#B5B9A8', completed: '#1C300B', cancelled: '#D3D6C8',
};

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function preset(id) {
  const t = new Date();
  const to = ymd(t);
  if (id === '30') return { from: ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 29)), to };
  if (id === '90') return { from: ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 89)), to };
  if (id === 'q') return { from: ymd(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1)), to };
  if (id === 'ytd') return { from: `${t.getFullYear()}-01-01`, to };
  return null;
}
const PRESETS = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['q', 'This quarter'], ['ytd', 'Year to date'], ['custom', 'Custom']];

const fmt = (v, unit = '') => (v === null || v === undefined ? '—' : `${typeof v === 'number' ? Math.round(v * 10) / 10 : v}${unit}`);
function hrs(h) {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

export default async function (main, ctx) {
  setTitle('Reports');
  if (!isMarketing()) {
    main.innerHTML = String(html`<div class="page narrow">${empty('Reports are for the marketing team', '', { art: 'lock' })}</div>`);
    return;
  }
  const p = ctx.query.range && ctx.query.range !== 'custom' ? preset(ctx.query.range) : null;
  const state = {
    range: ctx.query.range || (ctx.query.from ? 'custom' : '90'),
    from: ctx.query.from || (p || preset('90')).from,
    to: ctx.query.to || (p || preset('90')).to,
  };
  if (state.range !== 'custom') Object.assign(state, preset(state.range));

  main.innerHTML = String(html`<div class="page wide reports">
    <div class="page-head"><div><p class="eyebrow">Marketing</p><h1>Reports</h1>
      <p class="lede">How much the team is asked for, how fast it moves, and how it lands. Figures cover requests submitted in the range; “Right now” is today’s open work.</p></div>
      <a class="btn" data-export href="#" download>${icon('download', 18)}Export CSV</a></div>
    <form class="filters range-bar" data-range>
      <div class="seg" role="group" aria-label="Date range">${PRESETS.map(([id, l]) => html`<button type="button" data-preset="${id}" aria-pressed="${state.range === id}">${l}</button>`)}</div>
      <div class="custom-range" data-custom ${state.range === 'custom' ? '' : 'hidden'}>
        <label class="small" for="r-from">From</label><input class="input" type="date" id="r-from" name="from" value="${state.from}" max="${todayYmd()}" />
        <label class="small" for="r-to">To</label><input class="input" type="date" id="r-to" name="to" value="${state.to}" max="${todayYmd()}" />
        <button type="submit" class="btn sm primary">Apply</button>
      </div>
      <p class="small muted range-label" data-range-label></p>
    </form>
    <div data-out>${spinner()}</div>
  </div>`);

  const out = main.querySelector('[data-out]');
  const form = main.querySelector('[data-range]');

  function sync() {
    const q = new URLSearchParams(state.range === 'custom' ? { range: 'custom', from: state.from, to: state.to } : state.range === '90' ? {} : { range: state.range });
    history.replaceState({}, '', '/reports' + (q.toString() ? '?' + q : ''));
    main.querySelector('[data-export]').href = `/api/reports/export.csv?from=${state.from}&to=${state.to}`;
    main.querySelector('[data-range-label]').textContent = `${fmtDate(state.from, { year: true })} – ${fmtDate(state.to, { year: true })}`;
  }

  async function load() {
    sync();
    out.setAttribute('aria-busy', 'true');
    try {
      const d = await api.get(`/api/reports?from=${state.from}&to=${state.to}`);
      out.innerHTML = String(render(d));
    } catch (e) {
      out.innerHTML = String(empty('We couldn’t build the report', e.message, { art: 'alert' }));
    }
    out.removeAttribute('aria-busy');
  }

  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    state.range = b.dataset.preset;
    form.querySelectorAll('[data-preset]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    form.querySelector('[data-custom]').hidden = state.range !== 'custom';
    if (state.range === 'custom') return form.querySelector('#r-from').focus();
    Object.assign(state, preset(state.range));
    form.from.value = state.from;
    form.to.value = state.to;
    load();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.from.value || !form.to.value) return;
    if (form.from.value > form.to.value) return form.to.setCustomValidity('The end date is before the start.'), form.reportValidity(), form.to.setCustomValidity('');
    state.from = form.from.value;
    state.to = form.to.value;
    load();
  });

  // Hover tooltips on the trend chart.
  out.addEventListener('pointermove', (e) => {
    const hit = e.target.closest('[data-tip]');
    const tip = out.querySelector('[data-tooltip]');
    const chart = e.target.closest('.trend');
    if (!tip || !chart) return;
    out.querySelectorAll('.trend .hover-line').forEach((l) => l.classList.remove('on'));
    if (!hit) return void (tip.hidden = true);
    out.querySelector(`.hover-line[data-i="${hit.dataset.i}"]`)?.classList.add('on');
    tip.innerHTML = hit.dataset.tip;
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    const x = e.clientX - box.left;
    tip.style.left = `${Math.min(Math.max(x, 70), box.width - 70)}px`;
    tip.style.top = `${e.clientY - box.top - 12}px`;
  });
  out.addEventListener('pointerleave', () => {
    const tip = out.querySelector('[data-tooltip]');
    if (tip) tip.hidden = true;
    out.querySelectorAll('.trend .hover-line').forEach((l) => l.classList.remove('on'));
  });

  await load();
}

// ------------------------------------------------------------------ rendering
function render(d) {
  const k = d.kpis;
  const n = d.now;
  const nothing = !k.submitted && !k.completed;
  const tiles = [
    { l: 'Submitted', v: fmt(k.submitted), h: 'Requests sent in this range' },
    { l: 'Delivered', v: fmt(k.completed), h: 'Accepted or marked delivered in this range' },
    { l: 'On time', v: fmt(k.on_time_pct, '%'), h: 'Delivered by the due date', good: k.on_time_pct !== null && k.on_time_pct >= 85, bad: k.on_time_pct !== null && k.on_time_pct < 60 },
    { l: 'Approval time', v: hrs(k.median_approval_hours), h: 'Median, submitted to approved or declined' },
    { l: 'First response', v: hrs(k.median_first_response_hours), h: 'Median, approval to marketing’s first reply or start' },
    { l: 'Turnaround', v: k.median_turnaround_days === null ? '—' : `${fmt(k.median_turnaround_days)} days`, h: 'Median, approval to delivery' },
    { l: 'Satisfaction', v: k.avg_rating === null ? '—' : `${fmt(k.avg_rating)} / 5`, h: k.ratings ? `From ${k.ratings} rating${k.ratings === 1 ? '' : 's'}` : 'No ratings yet' },
    { l: 'Right first time', v: fmt(k.first_time_right_pct, '%'), h: `Delivered with no change requests · ${fmt(k.avg_revisions)} rounds on average` },
    { l: 'Brief quality', v: fmt(k.avg_brief_score, '%'), h: 'Average completeness when submitted' },
    { l: 'Rush requests', v: fmt(k.rush_pct, '%'), h: 'Due inside the standard turnaround' },
    { l: 'Approval rate', v: fmt(k.approval_rate_pct, '%'), h: `${k.declined_once} declined at least once` },
  ];
  return html`
    <section aria-labelledby="h-kpi" class="rep-section">
      <h2 id="h-kpi" class="visually-hidden">Key numbers</h2>
      ${nothing ? html`<div class="card pad notice">${icon('info')}<p>No requests were submitted or delivered in this range yet. Try a longer range.</p></div>` : ''}
      <div class="kpis">${tiles.map((t, i) => html`<div class="card kpi rise ${t.good ? 'good' : ''} ${t.bad ? 'bad' : ''}" style="--i:${i}"><span class="kpi-l">${t.l}</span><span class="kpi-v">${t.v}</span><span class="kpi-h">${t.h}</span></div>`)}</div>
    </section>

    <div class="rep-grid">
      <section class="card rep-card span-2" aria-labelledby="h-trend">
        <div class="card-head"><h2 id="h-trend">Requests per week</h2>
          <div class="legend" aria-hidden="true">${Object.values(SERIES).map((s) => html`<span><i style="background:${s.color}"></i>${s.label}</span>`)}</div></div>
        <div class="card-body">${trendChart(d.trend)}</div>
      </section>

      <section class="card rep-card" aria-labelledby="h-now">
        <div class="card-head"><h2 id="h-now">Right now</h2><span class="small muted">${n.open} open</span></div>
        <div class="card-body">
          <div class="now-figs">
            <a class="now-fig ${n.overdue ? 'bad' : ''}" href="/queue?view=list" data-link><b>${n.overdue}</b><span>overdue</span></a>
            <a class="now-fig ${n.unassigned ? 'warn' : ''}" href="/queue?who=none" data-link><b>${n.unassigned}</b><span>unassigned</span></a>
            <a class="now-fig" href="/requests?scope=all&status=pending_approval" data-link><b>${n.by_status.pending_approval || 0}</b><span>awaiting approval</span></a>
          </div>
          ${statusBar(n.by_status)}
          <h3 class="sub-h">Age of open requests</h3>
          ${barTable(n.aging.map((a) => ({ label: a.label, value: a.n })), { unit: 'requests', caption: 'Open requests by age since submission' })}
        </div>
      </section>

      <section class="card rep-card" aria-labelledby="h-cat">
        <div class="card-head"><h2 id="h-cat">By category</h2></div>
        <div class="card-body">${breakdown(d.by_category)}</div>
      </section>
      <section class="card rep-card" aria-labelledby="h-type">
        <div class="card-head"><h2 id="h-type">By request type</h2></div>
        <div class="card-body">${breakdown(d.by_type)}</div>
      </section>
      <section class="card rep-card" aria-labelledby="h-dept">
        <div class="card-head"><h2 id="h-dept">By department</h2></div>
        <div class="card-body">${barTable(d.by_department.map((g) => ({ label: g.key === '—' ? 'Not set' : g.key, value: g.count })), { unit: 'requests', caption: 'Requests by department' })}</div>
      </section>

      <section class="card rep-card span-2" aria-labelledby="h-people">
        <div class="card-head"><h2 id="h-people">${d.lead ? 'Team workload and delivery' : 'Your workload and delivery'}</h2></div>
        ${people(d)}
      </section>
      <section class="card rep-card" aria-labelledby="h-req">
        <div class="card-head"><h2 id="h-req">Top requesters</h2></div>
        <div class="card-body">${barTable(d.by_requester.map((g) => ({ label: nameOf(g.key, d.names), value: g.count })), { unit: 'requests', caption: 'Requests per person' })}</div>
      </section>

      <section class="card rep-card span-3" aria-labelledby="h-late">
        <div class="card-head"><h2 id="h-late">Overdue now</h2><span class="small muted">${n.overdue_list.length ? `${n.overdue_list.length} shown, oldest first` : ''}</span></div>
        ${n.overdue_list.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Request</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Was due</th></tr></thead>
          <tbody>${n.overdue_list.map((r) => html`<tr class="late"><td class="t-title"><span class="ref">${r.ref}</span> <a href="/requests/${r.ref}" data-link>${r.title}</a></td>
            <td>${statusBadge(r.status)}</td><td>${person(r.assignee_email, d.names)}</td><td class="nowrap"><span class="due late">${fmtDate(r.due_date)}</span></td></tr>`)}</tbody></table></div>`
        : html`<div class="card-body">${empty('Nothing is overdue', 'Every open request is on track.', { art: 'checkCircle' })}</div>`}
      </section>
    </div>`;
}

/** Weekly line chart, submitted vs completed. Thin 2px lines, ≥8px markers, hover tooltips, a table view. */
function trendChart(rows) {
  if (!rows.length) return html`<p class="muted">No weeks in this range.</p>`;
  const W = 720, H = 240, L = 34, R = 16, T = 14, B = 30;
  const max = Math.max(4, ...rows.flatMap((r) => [r.submitted, r.completed]));
  const step = max <= 6 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : Math.ceil(max / 5 / 10) * 10;
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (rows.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (rows.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const every = Math.ceil(rows.length / 8);
  const line = (key) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join('');
  const total = (key) => rows.reduce((a, r) => a + r[key], 0);
  const colW = rows.length > 1 ? (W - L - R) / (rows.length - 1) : W - L - R;
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="Line chart of requests per week. ${total('submitted')} submitted and ${total('completed')} completed across ${rows.length} weeks. A table view follows.">
    ${ticks.map((v) => `<g class="gl"><line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text></g>`).join('')}
    ${rows.map((r, i) => (i % every === 0 ? `<text class="xl" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(fmtDate(r.week))}</text>` : '')).join('')}
    ${rows.map((r, i) => `<line class="hover-line" data-i="${i}" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/>`).join('')}
    ${['submitted', 'completed'].map((k) => `<path d="${line(k)}" fill="none" stroke="${SERIES[k].color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    ${['submitted', 'completed'].map((k) => rows.map((r, i) => `<circle cx="${x(i)}" cy="${y(r[k])}" r="4" fill="${SERIES[k].color}" stroke="#fff" stroke-width="2"/>`).join('')).join('')}
    ${rows.map((r, i) => `<rect class="hit" data-i="${i}" data-tip="${esc(`<strong>Week of ${esc(fmtDate(r.week))}</strong><span><i style="background:${SERIES.submitted.color}"></i>Submitted ${r.submitted}</span><span><i style="background:${SERIES.completed.color}"></i>Completed ${r.completed}</span>`)}" x="${x(i) - colW / 2}" y="${T}" width="${colW}" height="${H - T - B}"/>`).join('')}
  </svg>`;
  return html`<div class="trend">${raw(svg)}<div class="tooltip" data-tooltip hidden role="presentation"></div></div>
    <details class="table-view"><summary>Show as a table</summary><div class="table-wrap"><table class="table compact">
      <thead><tr><th scope="col">Week of</th><th scope="col">Submitted</th><th scope="col">Completed</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td>${fmtDate(r.week, { year: true })}</td><td class="num">${r.submitted}</td><td class="num">${r.completed}</td></tr>`)}</tbody></table></div></details>`;
}

/** Open work by status: one segmented bar (2px gaps), labelled legend with counts. */
function statusBar(by) {
  const entries = Object.entries(by).filter(([s, v]) => v && STATUSES[s]?.open);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!total) return html`<p class="muted small">No open requests.</p>`;
  return html`<div class="status-bar" role="img" aria-label="${entries.map(([s, v]) => `${STATUSES[s].label}: ${v}`).join(', ')}">
      ${entries.map(([s, v]) => html`<span style="flex:${v};background:${STATUS_FILL[s]}" title="${STATUSES[s].label}: ${v}"></span>`)}</div>
    <ul class="status-legend">${entries.map(([s, v]) => html`<li><i style="background:${STATUS_FILL[s]}"></i><a href="/requests?scope=all&status=${s}" data-link>${STATUSES[s].label}</a><b>${v}</b></li>`)}</ul>`;
}

/** A table whose value column carries an inline bar (single hue, magnitude). */
function barTable(rows, { unit = '', caption = '' } = {}) {
  if (!rows.length || rows.every((r) => !r.value)) return html`<p class="muted small">Nothing in this range.</p>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return html`<table class="bar-table"><caption class="visually-hidden">${caption}</caption>
    <thead class="visually-hidden"><tr><th scope="col">Group</th><th scope="col">${unit}</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><th scope="row">${r.label}</th><td><span class="bar"><span style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span><span class="num">${r.value}</span></td></tr>`)}</tbody></table>`;
}

function breakdown(groups) {
  if (!groups.length) return html`<p class="muted small">Nothing in this range.</p>`;
  const max = Math.max(...groups.map((g) => g.count), 1);
  return html`<div class="table-wrap"><table class="table compact breakdown">
    <thead><tr><th scope="col">Type</th><th scope="col">Requests</th><th scope="col" class="num">Done</th><th scope="col" class="num">On time</th><th scope="col" class="num">Cycle</th></tr></thead>
    <tbody>${groups.map((g) => html`<tr><th scope="row">${g.label}</th>
      <td><span class="bar"><span style="width:${Math.max(3, (g.count / max) * 100)}%"></span></span><span class="num">${g.count}</span></td>
      <td class="num">${g.completed}</td><td class="num">${fmt(g.on_time_pct, '%')}</td><td class="num">${g.median_cycle_days === null ? '—' : `${fmt(g.median_cycle_days)}d`}</td></tr>`)}</tbody></table></div>`;
}

function people(d) {
  if (!d.by_assignee.length) return html`<div class="card-body">${empty('No assigned work yet', 'Once requests have owners, workload and delivery show here.', { art: 'users' })}</div>`;
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Person</th><th scope="col" class="num">Open</th><th scope="col" class="num">In review</th><th scope="col" class="num">Overdue</th>
      <th scope="col" class="num">Delivered</th><th scope="col" class="num">On time</th><th scope="col" class="num">Turnaround</th><th scope="col" class="num">Rating</th></tr></thead>
    <tbody>${d.by_assignee.map((a) => html`<tr><th scope="row">${person(a.key, d.names)}</th>
      <td class="num"><a href="/queue?who=${encodeURIComponent(a.key)}" data-link>${a.open}</a></td><td class="num">${a.in_review}</td>
      <td class="num ${a.overdue ? 'late-n' : ''}">${a.overdue}</td><td class="num">${a.completed}</td><td class="num">${fmt(a.on_time_pct, '%')}</td>
      <td class="num">${a.median_turnaround_days === null ? '—' : `${fmt(a.median_turnaround_days)} days`}</td><td class="num">${a.avg_rating === null ? '—' : `${fmt(a.avg_rating)} / 5`}</td></tr>`)}</tbody></table></div>`;
}
