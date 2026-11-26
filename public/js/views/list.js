// Request lists: Mine (incl. drafts), To approve, Following, Assigned to me and All requests (marketing).
// Filters live in the URL (?scope=&q=&status=&type=&sort=) so a filtered list can be shared or bookmarked.
// The approvals tab shows richer cards with inline Approve / Decline.

import { api } from '../lib/api.js';
import { store, isMarketing } from '../lib/store.js';
import {
  html,
  icon,
  requestRow,
  statusBadge,
  person,
  dueLabel,
  priorityLabel,
  dialog,
  toast,
  empty,
  spinner,
  debounce,
  setTitle,
  nameOf,
  ago,
  plural,
} from '../lib/ui.js';
import { STATUSES } from '../shared/workflow.js';
import { CATEGORIES, TYPES, TYPE_BY_ID } from '../shared/catalog.js';

const DECIDED = ['approved', 'in_progress', 'in_review', 'on_hold', 'needs_info', 'completed', 'cancelled', 'rejected'];

function tabsFor() {
  const t = [{ id: 'mine', label: 'Mine', href: '/requests?scope=mine' }];
  if (store.me.is_approver || store.counts.approvals)
    t.push({ id: 'approvals', label: 'To approve', href: '/approvals', n: store.counts.approvals });
  t.push({ id: 'watching', label: 'Following', href: '/requests?scope=watching' });
  if (isMarketing()) {
    t.push({ id: 'assigned', label: 'Assigned to me', href: '/requests?scope=assigned' });
    t.push({ id: 'all', label: 'All requests', href: '/requests?scope=all' });
  }
  return t;
}

const TITLES = {
  mine: ['My requests', 'Everything you’ve asked marketing for, including drafts you haven’t sent yet.'],
  approvals: ['Approvals', 'Requests from your team waiting for your go-ahead. Approved work goes straight to marketing.'],
  watching: ['Following', 'Requests you’ve been added to or chose to follow.'],
  assigned: ['Assigned to me', 'Work the marketing team has given you.'],
  all: ['All requests', 'Every submitted request across Yondr.'],
  involved: ['Search results', 'Requests you’re part of.'],
};

export default async function (main, ctx) {
  let scope = ctx.params.scope || ctx.query.scope || 'mine';
  if (!TITLES[scope]) scope = 'mine';
  if ((scope === 'all' || scope === 'assigned') && !isMarketing()) scope = 'involved';
  const q = {
    q: ctx.query.q || '',
    status: ctx.query.status || '',
    type: ctx.query.type || '',
    sort: ctx.query.sort || (scope === 'approvals' ? 'due' : 'updated'),
    view: ctx.query.view || 'waiting',
  };
  const [title, lede] = TITLES[scope];
  setTitle(title);
  const tabs = tabsFor();
  const showTabs = tabs.some((t) => t.id === scope);

  main.innerHTML = String(
    html`<div class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">Requests</p>
          <h1>${title}</h1>
          <p class="lede">${lede}</p>
        </div>
        <a class="btn lime" href="/new" data-link>${icon('plus')}New request</a>
      </div>
      ${showTabs ? html`<nav class="tabs" aria-label="Lists">${tabs.map((t) => html`<a class="tab" href="${t.href}" data-link ${t.id === scope ? html`aria-current="page"` : ''}>${t.label}${t.n ? html`<span class="n">${t.n}</span>` : ''}</a>`)}</nav>` : ''}
      ${
        scope === 'approvals'
          ? html`<div class="filters">
              <div class="seg" role="group" aria-label="Show">
                <button type="button" data-view="waiting" aria-pressed="${q.view !== 'decided'}">Waiting on me</button>
                <button type="button" data-view="decided" aria-pressed="${q.view === 'decided'}">Decided</button>
              </div>
            </div>`
          : ''
      }
      ${scope !== 'approvals' || q.view === 'decided' ? filterBar(q, scope) : ''}
      <p class="result-count small muted" data-count aria-live="polite"></p>
      <div data-results>${spinner()}</div>
    </div>`,
  );

  const results = main.querySelector('[data-results]');
  const countEl = main.querySelector('[data-count]');
  let seq = 0;

  function syncUrl() {
    const p = new URLSearchParams();
    if (scope !== 'approvals' && scope !== 'mine') p.set('scope', scope);
    for (const k of ['q', 'status', 'type', 'sort', 'view'])
      if (q[k] && !(k === 'view' && q[k] === 'waiting') && !(k === 'sort' && q[k] === 'updated')) p.set(k, q[k]);
    const base = scope === 'approvals' ? '/approvals' : '/requests';
    const url = base + (p.toString() ? '?' + p : '');
    history.replaceState({}, '', url);
  }

  async function load() {
    const id = ++seq;
    const p = new URLSearchParams({ scope, sort: q.sort, limit: '300' });
    if (q.q) p.set('q', q.q);
    if (q.type) p.set('type', q.type);
    if (scope === 'approvals')
      p.set('status', q.view === 'decided' ? (q.status && q.status !== 'open' ? q.status : DECIDED.join(',')) : 'pending_approval');
    else if (q.status === 'open') p.set('open', '1');
    else if (q.status) p.set('status', q.status);
    try {
      const d = await api.get('/api/requests?' + p);
      if (id !== seq) return;
      let items = d.items;
      countEl.textContent = items.length ? plural(items.length, 'request') + (items.length >= 300 ? ' (showing the first 300)' : '') : '';
      if (scope === 'approvals' && q.view !== 'decided') return renderApprovals(items, d.names);
      if (!items.length) {
        results.innerHTML = String(emptyFor(scope, q));
        return;
      }
      results.innerHTML = String(
        html`<div class="card req-list">
          ${items.map((r, i) => requestRow(r, { me: store.me, names: d.names, showRequester: scope !== 'mine', i }))}
        </div>`,
      );
    } catch (e) {
      if (id !== seq) return;
      results.innerHTML = String(empty('We couldn’t load this list', e.message, { art: 'alert' }));
    }
  }

  async function renderApprovals(items, names) {
    if (!items.length) {
      results.innerHTML = String(
        empty(
          'Nothing waiting for you',
          'When someone on your team asks for marketing work, it lands here for your approval. You’ll also get an email.',
          { art: 'checkCircle' },
        ),
      );
      return;
    }
    // Pull each brief so the decision can be made right here (approval lists are short).
    const details = await Promise.all(items.slice(0, 30).map((r) => api.get(`/api/requests/${r.ref}`).catch(() => null)));
    results.innerHTML = String(html`<div class="approvals">${items.map((r, i) => approvalCard(r, details[i], names, i))}</div>`);
  }

  function approvalCard(r, d, names, i) {
    const brief = d?.request?.brief || {};
    const obj = typeof brief.objective === 'string' ? brief.objective : '';
    const aud = Array.isArray(brief.audience) ? brief.audience.join(', ') : '';
    return html`<article class="card approval rise" style="--i:${Math.min(i, 8)}" data-ref="${r.ref}">
      <div class="approval-main">
        <div class="row wrap-gap">
          <span class="ref">${r.ref}</span><span class="small muted">${r.type_name}</span>${priorityLabel(r.priority)}
        </div>
        <h2 class="approval-title"><a href="/requests/${r.ref}" data-link>${r.title || 'Untitled request'}</a></h2>
        ${obj ? html`<p class="approval-obj">${obj.length > 260 ? obj.slice(0, 260) + '…' : obj}</p>` : ''}
        <dl class="approval-facts">
          <div>
            <dt>Requested by</dt>
            <dd>${person(r.requester_email, names)}</dd>
          </div>
          <div>
            <dt>Needed</dt>
            <dd>${dueLabel(r.due_date)}</dd>
          </div>
          ${
            aud
              ? html`<div>
                  <dt>Audience</dt>
                  <dd>${aud}</dd>
                </div>`
              : ''
          }
          <div>
            <dt>Brief</dt>
            <dd>
              <span class="score-pill ${r.brief_score >= 75 ? 'good' : r.brief_score >= 50 ? 'ok' : 'low'}"
                >${r.brief_score}% complete</span
              >
            </dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>${ago(r.submitted_at)}</dd>
          </div>
        </dl>
      </div>
      <div class="approval-actions">
        <button type="button" class="btn primary" data-approve="${r.ref}">${icon('check', 18)}Approve</button>
        <button type="button" class="btn" data-decline="${r.ref}">Decline</button>
        <a class="btn ghost" href="/requests/${r.ref}" data-link>Open brief${icon('arrowRight', 18)}</a>
      </div>
    </article>`;
  }

  results.addEventListener('click', async (e) => {
    const ap = e.target.closest('[data-approve]');
    const de = e.target.closest('[data-decline]');
    if (!ap && !de) return;
    const ref = (ap || de).dataset.approve || (ap || de).dataset.decline;
    const v = ap
      ? await dialog({
          title: `Approve ${ref}?`,
          text: 'It goes straight to the marketing team, and the requester is told.',
          confirm: 'Approve',
          body: html`<div class="field">
            <label class="label" for="ap-note">Note for the requester <span class="opt">optional</span></label
            ><textarea class="textarea" id="ap-note" name="note" rows="3" placeholder="e.g. Approved. Keep it under budget."></textarea>
          </div>`,
        })
      : await dialog({
          title: `Decline ${ref}?`,
          text: 'The requester can revise and resubmit, or cancel. Tell them what would get it approved.',
          confirm: 'Decline',
          tone: 'danger',
          body: html`<div class="field">
            <label class="label" for="de-note">Why <span class="req">*</span></label
            ><textarea class="textarea" id="de-note" name="note" rows="4" required></textarea>
          </div>`,
        });
    if (!v) return;
    const btn = ap || de;
    btn.disabled = true;
    try {
      await api.post(`/api/requests/${ref}/actions/${ap ? 'approve' : 'reject'}`, { note: v.note || '' });
      toast(ap ? `${ref} approved and sent to marketing.` : `${ref} declined. The requester has been told.`);
      ctx.refreshCounts();
      load();
    } catch (err) {
      btn.disabled = false;
      toast(err.message, { error: true });
    }
  });

  main.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]');
    if (!v) return;
    q.view = v.dataset.view;
    q.status = '';
    syncUrl();
    ctx.navigate(location.pathname + location.search, { replace: true });
  });

  const form = main.querySelector('[data-filters]');
  if (form) {
    const onSearch = debounce(() => {
      syncUrl();
      load();
    }, 300);
    form.addEventListener('input', (e) => {
      if (e.target.name === 'q') {
        q.q = e.target.value.trim();
        onSearch();
      }
    });
    form.addEventListener('change', (e) => {
      if (!['status', 'type', 'sort'].includes(e.target.name)) return;
      q[e.target.name] = e.target.value;
      syncUrl();
      load();
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    form.querySelector('[data-clear]')?.addEventListener('click', () => {
      Object.assign(q, { q: '', status: '', type: '', sort: 'updated' });
      form.reset();
      for (const el of form.elements) if (el.name && el.name in q) el.value = q[el.name];
      syncUrl();
      load();
    });
  }
  load();
}

function filterBar(q, scope) {
  const statuses = Object.entries(STATUSES).filter(([s]) => scope === 'mine' || s !== 'draft');
  return html`<form class="filters" data-filters role="search">
    <div class="filter-search">
      <label class="visually-hidden" for="f-q">Search these requests</label>${icon('search', 18)}
      <input
        class="input"
        id="f-q"
        name="q"
        type="search"
        value="${q.q}"
        placeholder="Search title, ref, requester or brief"
        autocomplete="off"
      />
    </div>
    <label class="visually-hidden" for="f-status">Status</label>
    <select class="select" id="f-status" name="status">
      <option value="">Any status</option>
      <option value="open" ${q.status === 'open' ? 'selected' : ''}>Open</option>
      ${statuses.map(([s, v]) => html`<option value="${s}" ${q.status === s ? 'selected' : ''}>${v.label}</option>`)}
    </select>
    <label class="visually-hidden" for="f-type">Type</label>
    <select class="select" id="f-type" name="type">
      <option value="">Any type</option>
      ${CATEGORIES.map((c) => html`<optgroup label="${c.name}">${TYPES.filter((t) => t.category === c.id).map((t) => html`<option value="${t.id}" ${q.type === t.id ? 'selected' : ''}>${t.name}</option>`)}</optgroup>`)}
    </select>
    <label class="visually-hidden" for="f-sort">Sort</label>
    <select class="select" id="f-sort" name="sort">
      ${[
        ['updated', 'Recently updated'],
        ['due', 'Due date'],
        ['created', 'Newest'],
        ['priority', 'Priority'],
      ].map(([v, l]) => html`<option value="${v}" ${q.sort === v ? 'selected' : ''}>${l}</option>`)}
    </select>
    ${q.q || q.status || q.type ? html`<button type="button" class="btn ghost sm" data-clear>Clear</button>` : html`<button type="button" class="btn ghost sm" data-clear hidden>Clear</button>`}
  </form>`;
}

function emptyFor(scope, q) {
  const filtered = q.q || q.status || q.type;
  if (filtered) return empty('No requests match', 'Try a different search or clear the filters.', { art: 'search' });
  const cta = html`<a class="btn lime" href="/new" data-link>${icon('plus')}Start a request</a>`;
  if (scope === 'mine')
    return empty(
      'You haven’t asked for anything yet',
      'Need a deck, ads, a booth kit or copy? Start a request: it takes a few minutes, and you can follow it all the way to delivery.',
      { art: 'sparkle', action: cta },
    );
  if (scope === 'watching')
    return empty('You’re not following any requests', 'Open a request and choose Follow to get its updates here.', { art: 'eye' });
  if (scope === 'assigned')
    return empty('Nothing assigned to you', 'Pick up work from the queue, or a lead will assign it.', {
      art: 'board',
      action: html`<a class="btn" href="/queue" data-link>Open the work queue</a>`,
    });
  return empty('No requests yet', 'Requests appear here once they’re submitted.', { art: 'inbox', action: cta });
}
