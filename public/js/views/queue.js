// The marketing work queue: everything approved and not yet delivered, as a Board, a sortable List or a Calendar
// of due dates. Unassigned work can be taken in one click; leads can assign it to anyone on the team.

import { api } from '../lib/api.js';
import { store, isMarketing, isLead, loadPeople } from '../lib/store.js';
import {
  html,
  icon,
  statusBadge,
  person,
  avatar,
  dueLabel,
  priorityLabel,
  dialog,
  toast,
  empty,
  spinner,
  debounce,
  setTitle,
  nameOf,
  fmtDate,
  todayYmd,
  plural,
  estimateLabel,
} from '../lib/ui.js';
import { CATEGORIES, TYPE_BY_ID } from '../shared/catalog.js';

const COLUMNS = [
  {
    id: 'unassigned',
    label: 'Unassigned',
    hint: 'Approved and waiting for an owner',
    test: (r) => r.status === 'approved' && !r.assignee_email,
  },
  { id: 'ready', label: 'Ready to start', hint: 'Assigned, not started', test: (r) => r.status === 'approved' && !!r.assignee_email },
  { id: 'in_progress', label: 'In production', hint: 'Being made', test: (r) => r.status === 'in_progress' },
  { id: 'needs_info', label: 'Waiting on requester', hint: 'Paused for an answer', test: (r) => r.status === 'needs_info' },
  { id: 'in_review', label: 'In review', hint: 'Delivered, waiting for sign-off', test: (r) => r.status === 'in_review' },
  { id: 'on_hold', label: 'On hold', hint: 'Paused', test: (r) => r.status === 'on_hold' },
];
const BOARD_STATUSES = ['approved', 'in_progress', 'needs_info', 'in_review', 'on_hold'];
const ACTIVE = ['approved', 'in_progress', 'needs_info', 'on_hold'];
const PRIO_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const VIEW_KEY = 'mrp.queue.view';

const getView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) || 'board';
  } catch {
    return 'board';
  }
};
const setView = (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {}
};

export default async function (main, ctx) {
  setTitle('Work queue');
  if (!isMarketing()) {
    main.innerHTML = String(
      html`<div class="page narrow">
        ${empty('The work queue is for the marketing team', 'You can follow your own requests under My requests.', { art: 'lock', action: html`<a class="btn primary" href="/requests" data-link>My requests</a>` })}
      </div>`,
    );
    return;
  }
  const state = {
    view: ['board', 'list', 'calendar'].includes(ctx.query.view) ? ctx.query.view : getView(),
    who: ctx.query.who || 'all',
    category: ctx.query.category || '',
    q: ctx.query.q || '',
    sort: { key: 'due', dir: 1 },
    month: (() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1);
    })(),
    items: [],
    names: {},
  };

  main.innerHTML = String(
    html`<div class="page wide">
      <div class="page-head">
        <div>
          <p class="eyebrow">Marketing</p>
          <h1>Work queue</h1>
          <p class="lede">Approved work from across Yondr. Take what’s yours, keep requesters posted, and deliver for review.</p>
        </div>
        <div class="seg" role="group" aria-label="View" data-views>
          ${[
            ['board', 'Board', 'board'],
            ['list', 'List', 'list'],
            ['calendar', 'Calendar', 'calendar'],
          ].map(([v, l, i]) => html`<button type="button" data-v="${v}" aria-pressed="${state.view === v}">${icon(i, 16)}${l}</button>`)}
        </div>
      </div>
      <div class="workload" data-workload aria-label="Open work per person"></div>
      <form class="filters" data-filters role="search">
        <div class="filter-search">
          <label class="visually-hidden" for="qq">Search the queue</label>${icon('search', 18)}
          <input
            class="input"
            id="qq"
            name="q"
            type="search"
            value="${state.q}"
            placeholder="Search title, ref or requester"
            autocomplete="off"
          />
        </div>
        <label class="visually-hidden" for="qwho">Whose work</label>
        <select class="select" id="qwho" name="who" data-who></select>
        <label class="visually-hidden" for="qcat">Category</label>
        <select class="select" id="qcat" name="category">
          <option value="">All categories</option>
          ${CATEGORIES.map((c) => html`<option value="${c.id}" ${state.category === c.id ? 'selected' : ''}>${c.name}</option>`)}
        </select>
      </form>
      <p class="result-count small muted" data-count aria-live="polite"></p>
      <div data-out>${spinner()}</div>
    </div>`,
  );

  const out = main.querySelector('[data-out]');
  const team = (await loadPeople()).filter((p) => p.role !== 'requester');
  for (const p of team) state.names[p.email] = p.name;

  function whoOptions() {
    const sel = main.querySelector('[data-who]');
    sel.innerHTML = String(
      html`<option value="all">Everyone</option>
        <option value="mine">Mine</option>
        <option value="none">Unassigned</option>
        <optgroup label="Team">${team.map((p) => html`<option value="${p.email}">${p.name}</option>`)}</optgroup>`,
    );
    sel.value = state.who;
    if (sel.value !== state.who) {
      state.who = 'all';
      sel.value = 'all';
    }
  }
  whoOptions();

  async function load() {
    try {
      const d = await api.get(`/api/requests?scope=all&status=${BOARD_STATUSES.join(',')}&sort=due&limit=1000`);
      state.items = d.items;
      Object.assign(state.names, d.names);
      draw();
    } catch (e) {
      out.innerHTML = String(empty('We couldn’t load the queue', e.message, { art: 'alert' }));
    }
  }

  function filtered() {
    const q = state.q.toLowerCase();
    return state.items.filter((r) => {
      if (state.who === 'mine' && r.assignee_email !== store.me.email) return false;
      if (state.who === 'none' && r.assignee_email) return false;
      if (state.who.includes('@') && r.assignee_email !== state.who) return false;
      if (state.category && r.category_id !== state.category) return false;
      if (
        q &&
        ![r.title, r.ref, r.type_name, r.requester_email, nameOf(r.requester_email, state.names)].join(' ').toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.view !== 'board') p.set('view', state.view);
    if (state.who !== 'all') p.set('who', state.who);
    if (state.category) p.set('category', state.category);
    if (state.q) p.set('q', state.q);
    history.replaceState({}, '', '/queue' + (p.toString() ? '?' + p : ''));
  }

  function drawWorkload() {
    const open = state.items.filter((r) => ACTIVE.includes(r.status));
    const rows = team.map((p) => {
      const mine = open.filter((r) => r.assignee_email === p.email);
      return { p, n: mine.length, late: mine.filter((r) => r.overdue).length };
    });
    const unassigned = open.filter((r) => !r.assignee_email).length;
    main.querySelector('[data-workload]').innerHTML = String(
      html` <button
          type="button"
          class="wl ${state.who === 'none' ? 'on' : ''} ${unassigned ? 'alert' : ''}"
          data-wl="none"
          aria-pressed="${state.who === 'none'}"
        >
          <span class="wl-ico">${icon('inbox', 16)}</span><span class="wl-name">Unassigned</span><span class="wl-n">${unassigned}</span>
        </button>
        ${rows.map(
          ({ p, n, late }) =>
            html`<button
              type="button"
              class="wl ${state.who === p.email ? 'on' : ''}"
              data-wl="${p.email}"
              aria-pressed="${state.who === p.email}"
              title="${p.name}: ${plural(n, 'open item')}${late ? `, ${late} overdue` : ''}"
            >
              ${avatar(p.email, p.name, 'sm')}<span class="wl-name"
                >${p.name.split(' ')[0]}${p.email === store.me.email ? ' (you)' : ''}</span
              ><span class="wl-n">${n}</span>${late ? html`<span class="wl-late">${late} late</span>` : ''}
            </button>`,
        )}`,
    );
  }

  function draw() {
    drawWorkload();
    const items = filtered();
    main.querySelector('[data-count]').textContent =
      `${plural(items.length, 'item')}${items.filter((r) => r.overdue).length ? ` · ${items.filter((r) => r.overdue).length} overdue` : ''}`;
    if (!state.items.length) {
      out.innerHTML = String(empty('The queue is clear', 'Approved requests land here. Nice work.', { art: 'checkCircle' }));
      return;
    }
    if (state.view === 'list') out.innerHTML = String(listView(items));
    else if (state.view === 'calendar') out.innerHTML = String(calendarView(items));
    else out.innerHTML = String(boardView(items));
  }

  // ---------------------------------------------------------------- board
  function card(r) {
    const t = TYPE_BY_ID[r.type_id];
    return html`<article class="qcard ${r.overdue ? 'late' : ''}" data-ref="${r.ref}">
      <div class="qcard-top">
        <span class="qcard-type" title="${r.type_name}">${icon(t?.icon || 'doc', 16)}</span
        ><span class="ref">${r.ref}</span> ${priorityLabel(r.priority)}
      </div>
      <h3 class="qcard-title"><a href="/requests/${r.ref}" data-link>${r.title || 'Untitled request'}</a></h3>
      <p class="qcard-sub">${r.type_name} · ${nameOf(r.requester_email, state.names)}</p>
      <div class="qcard-foot">
        ${dueLabel(r.due_date, r.status !== 'in_review')} ${estimateLabel(r)}
        ${r.open_questions ? html`<span class="prio p-high" title="Open questions">${icon('question', 14)}${r.open_questions}</span>` : ''}
        <span class="qcard-who"
          >${r.assignee_email ? html`<span title="${nameOf(r.assignee_email, state.names)}">${avatar(r.assignee_email, nameOf(r.assignee_email, state.names), 'sm')}</span>` : ''}</span
        >
      </div>
      ${
        !r.assignee_email || isLead()
          ? html`<div class="qcard-actions">
              ${!r.assignee_email ? html`<button type="button" class="btn sm primary" data-take="${r.ref}">Take it</button>` : ''}
              ${isLead() ? html`<button type="button" class="btn sm ghost" data-assign="${r.ref}">${r.assignee_email ? 'Reassign…' : 'Assign…'}</button>` : ''}
            </div>`
          : ''
      }
    </article>`;
  }
  function boardView(items) {
    return html`<div class="board" role="list" aria-label="Board">
      ${COLUMNS.map((c) => {
        const col = items.filter(c.test);
        return html`<section class="col col-${c.id}" role="listitem" aria-labelledby="col-${c.id}">
          <header class="col-head">
            <h2 id="col-${c.id}">${c.label}</h2>
            <span class="col-n">${col.length}</span>
          </header>
          <p class="col-hint">${c.hint}</p>
          <div class="col-cards">${col.length ? col.map(card) : html`<p class="col-empty">Nothing here</p>`}</div>
        </section>`;
      })}
    </div>`;
  }

  // ---------------------------------------------------------------- list
  const COLS = [
    ['ref', 'Ref', (r) => r.id],
    ['title', 'Request', (r) => (r.title || '').toLowerCase()],
    ['type', 'Type', (r) => r.type_name],
    ['status', 'Status', (r) => BOARD_STATUSES.indexOf(r.status)],
    ['assignee', 'Owner', (r) => nameOf(r.assignee_email, state.names) || '~'],
    ['requester', 'Requester', (r) => nameOf(r.requester_email, state.names)],
    ['due', 'Due', (r) => r.due_date || '9999'],
    ['priority', 'Priority', (r) => PRIO_RANK[r.priority] ?? 2],
  ];
  function listView(items) {
    const [, , key] = COLS.find((c) => c[0] === state.sort.key) || COLS[6];
    const rows = [...items].sort((a, b) => {
      const x = key(a),
        y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * state.sort.dir;
    });
    if (!rows.length) return empty('Nothing matches', 'Try another person or category.', { art: 'filter' });
    return html`<div class="table-wrap card">
      <table class="table">
        <caption class="visually-hidden">
          Work queue, sorted by ${state.sort.key}
        </caption>
        <thead>
          <tr>
            ${COLS.map(
              ([k, l]) =>
                html`<th scope="col" aria-sort="${state.sort.key === k ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">
                  <button type="button" class="th-sort" data-sort="${k}">
                    ${l}${state.sort.key === k ? html`<span class="sort-ic ${state.sort.dir > 0 ? 'asc' : 'desc'}">${icon('chevronDown', 14)}</span>` : ''}
                  </button>
                </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr class="${r.overdue ? 'late' : ''}">
                <td><span class="ref">${r.ref}</span></td>
                <td class="t-title">
                  <a href="/requests/${r.ref}" data-link>${r.title || 'Untitled request'}</a>
                </td>
                <td class="nowrap">${r.type_name}</td>
                <td>${statusBadge(r.status)}</td>
                <td>
                  ${r.assignee_email ? person(r.assignee_email, state.names) : html`<button type="button" class="btn sm" data-take="${r.ref}">Take it</button>`}
                </td>
                <td class="nowrap">${nameOf(r.requester_email, state.names)}</td>
                <td class="nowrap">${dueLabel(r.due_date, r.status !== 'in_review')}</td>
                <td>${priorityLabel(r.priority) || html`<span class="muted small">Normal</span>`}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  // ---------------------------------------------------------------- calendar
  function calendarView(items) {
    const m = state.month;
    const y = m.getFullYear(),
      mo = m.getMonth();
    const first = new Date(y, mo, 1);
    const start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const byDay = {};
    for (const r of items) if (r.due_date) (byDay[r.due_date] ||= []).push(r);
    const today = todayYmd();
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (i >= 35 && d.getMonth() !== mo) break;
      days.push(d);
    }
    const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const monthItems = Object.entries(byDay)
      .filter(([k]) => k.startsWith(ymd(first).slice(0, 7)))
      .sort();
    const noDate = items.filter((r) => !r.due_date).length;
    const chip = (r) =>
      html`<a class="cal-item ${r.overdue ? 'late' : ''} st-${r.status}" href="/requests/${r.ref}" data-link title="${r.ref}: ${r.title}"
        >${r.title || r.ref}</a
      >`;
    return html`<div class="cal card">
      <div class="cal-head">
        <button type="button" class="icon-btn" data-month="-1" aria-label="Previous month">${icon('chevronLeft')}</button>
        <h2 aria-live="polite">${label}</h2>
        <button type="button" class="icon-btn" data-month="1" aria-label="Next month">${icon('chevronRight')}</button>
        <button type="button" class="btn sm ghost" data-month="0">Today</button>
      </div>
      <div class="cal-grid" role="grid" aria-label="Due dates, ${label}">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<div class="cal-dow" role="columnheader">${d}</div>`)}
        ${days.map((d) => {
          const k = ymd(d),
            list = byDay[k] || [];
          return html`<div
            class="cal-day ${d.getMonth() !== mo ? 'out' : ''} ${k === today ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'weekend' : ''}"
            role="gridcell"
          >
            <span class="cal-num">${d.getDate()}</span
            >${list.slice(0, 4).map(chip)}${list.length > 4 ? html`<span class="cal-more">+${list.length - 4} more</span>` : ''}
          </div>`;
        })}
      </div>
      <div class="agenda">
        ${
          monthItems.length
            ? monthItems.map(
                ([k, list]) =>
                  html`<div class="agenda-day ${k === today ? 'today' : ''}">
                    <h3>${fmtDate(k, { weekday: true })}</h3>
                    ${list.map(chip)}
                  </div>`,
              )
            : html`<p class="muted small">Nothing due this month.</p>`
        }
      </div>
      ${noDate ? html`<p class="small muted cal-note">${plural(noDate, 'item')} without a due date ${noDate === 1 ? 'isn’t' : 'aren’t'} shown.</p>` : ''}
    </div>`;
  }

  // ---------------------------------------------------------------- events
  async function assign(ref, email) {
    try {
      await api.post(`/api/requests/${ref}/actions/assign`, { assignee: email });
      toast(email === store.me.email ? `${ref} is yours. Open it to start.` : `${ref} assigned to ${nameOf(email, state.names)}.`, {
        action: { href: `/requests/${ref}`, label: 'Open' },
      });
      ctx.refreshCounts();
      await load();
    } catch (e) {
      toast(e.message, { error: true });
    }
  }

  out.addEventListener('click', async (e) => {
    const take = e.target.closest('[data-take]');
    if (take) {
      take.disabled = true;
      return assign(take.dataset.take, store.me.email);
    }
    const as = e.target.closest('[data-assign]');
    if (as) {
      const r = state.items.find((x) => x.ref === as.dataset.assign);
      const v = await dialog({
        title: `Assign ${r.ref}`,
        text: r.title,
        confirm: 'Assign',
        body: html`<div class="field">
          <label class="label" for="as-who">Who should make this?</label>
          <select class="select" id="as-who" name="assignee" required>
            ${team.map((p) => {
              const n = state.items.filter((x) => x.assignee_email === p.email && ACTIVE.includes(x.status)).length;
              return html`<option value="${p.email}" ${p.email === r.assignee_email ? 'selected' : ''}>
                ${p.name} — ${plural(n, 'open item')}
              </option>`;
            })}
          </select>
        </div>`,
      });
      if (v) assign(r.ref, v.assignee);
      return;
    }
    const s = e.target.closest('[data-sort]');
    if (s) {
      state.sort = { key: s.dataset.sort, dir: state.sort.key === s.dataset.sort ? -state.sort.dir : 1 };
      draw();
      out.querySelector(`[data-sort="${s.dataset.sort}"]`)?.focus();
      return;
    }
    const mo = e.target.closest('[data-month]');
    if (mo) {
      const n = Number(mo.dataset.month);
      const d = new Date();
      state.month =
        n === 0 ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(state.month.getFullYear(), state.month.getMonth() + n, 1);
      draw();
      out.querySelector(`[data-month="${n}"]`)?.focus();
    }
  });
  main.querySelector('[data-views]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    state.view = b.dataset.v;
    setView(state.view);
    main.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    syncUrl();
    draw();
  });
  main.querySelector('[data-workload]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wl]');
    if (!b) return;
    state.who = state.who === b.dataset.wl ? 'all' : b.dataset.wl;
    main.querySelector('[data-who]').value = state.who;
    syncUrl();
    draw();
  });
  const form = main.querySelector('[data-filters]');
  form.addEventListener('submit', (e) => e.preventDefault());
  const onQ = debounce(() => {
    syncUrl();
    draw();
  }, 200);
  form.addEventListener('input', (e) => {
    if (e.target.name === 'q') {
      state.q = e.target.value.trim();
      onQ();
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'who') state.who = e.target.value;
    if (e.target.name === 'category') state.category = e.target.value;
    syncUrl();
    draw();
  });

  await load();
  const onVis = () => document.visibilityState === 'visible' && load();
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}
