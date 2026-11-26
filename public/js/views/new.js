// New request: pick what you need, then a five-step brief that asks only the questions that matter for that kind of
// work. Drafts autosave as you type. Routes: /new (picker, ?q= ?category= ?duplicate=), /new/:type (start a draft),
// /requests/:ref/edit (continue a draft, or edit a request that hasn't started yet).

import { api, upload, MAX_UPLOAD, ApiError } from '../lib/api.js';
import { store, loadPeople, loadSettings, isLead } from '../lib/store.js';
import {
  html, icon, dialog, confirmDialog, toast, fmtDate, setTitle, empty, spinner, avatar, nameOf, bytes, ago, todayYmd,
} from '../lib/ui.js';
import {
  CATEGORIES, TYPES, TYPE_BY_ID, BASE_FIELDS, DEPARTMENTS, PRIORITIES, visibleFields, fieldError, briefScore,
  earliestStandardDate, leadDaysFor, searchTypes, formatAnswer,
} from '../shared/catalog.js';

const STEPS = [
  { id: 'brief', label: 'The brief', title: 'Tell us what it’s for', lede: 'The goal and the audience matter more than the format. A few clear sentences save a round of questions.' },
  { id: 'details', label: 'Details', title: 'The specifics', lede: 'Questions for this kind of work. Skip what you don’t know; marketing will ask.' },
  { id: 'timing', label: 'Timing & people', title: 'When, and who’s involved', lede: 'Your due date, who approves it, and who else should follow along.' },
  { id: 'files', label: 'Files & links', title: 'Show us what you mean', lede: 'Drafts, examples, old versions, logos, data. Anything that helps.' },
  { id: 'review', label: 'Review', title: 'Check and send', lede: 'Here’s the brief marketing will see.' },
];
const TOP_STEP = { title: 0, due_date: 2, rush_reason: 2, approver_email: 2, priority: 2, department: 2 };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function newRequest(main, ctx) {
  const { params, query } = ctx;
  if (params.ref) return wizard(main, ctx, params.ref);
  if (params.type) {
    if (!TYPE_BY_ID[params.type]) {
      toast('We don’t know that kind of request. Pick one below.', { error: true });
      return ctx.navigate('/new', { replace: true });
    }
    main.innerHTML = String(spinner());
    try {
      const d = await api.post('/api/requests', { type_id: params.type });
      return ctx.navigate(`/requests/${d.request.ref}/edit`, { replace: true });
    } catch (e) {
      toast(e.message, { error: true });
      return ctx.navigate('/new', { replace: true });
    }
  }
  if (query.duplicate) {
    main.innerHTML = String(spinner());
    try {
      const d = await api.post('/api/requests', { duplicate_of: query.duplicate });
      toast(`Copied ${query.duplicate}. Check the dates and details, then submit.`);
      return ctx.navigate(`/requests/${d.request.ref}/edit`, { replace: true });
    } catch (e) {
      toast(e.message, { error: true });
      return ctx.navigate('/new', { replace: true });
    }
  }
  return picker(main, ctx);
}

// =================================================================== picker
async function picker(main, ctx) {
  setTitle('New request');
  main.innerHTML = String(spinner());
  const [settings, drafts] = await Promise.all([
    loadSettings(),
    api.get('/api/requests?scope=mine&status=draft&sort=updated').then((d) => d.items).catch(() => []),
  ]);
  const enabled = TYPES.filter((t) => settings[t.id]?.enabled !== false);
  const state = { q: ctx.query.q || '', cat: CATEGORIES.some((c) => c.id === ctx.query.category) ? ctx.query.category : '' };

  main.innerHTML = String(html`<div class="page picker">
    <header class="picker-head rise">
      <p class="eyebrow">New request</p>
      <h1>What do you need?</h1>
      <p class="lede">Pick the closest match. We’ll ask only the questions that matter for it, so marketing can start without chasing you.</p>
      <form class="picker-search" role="search" data-psearch>
        <label class="visually-hidden" for="pq">Search kinds of work</label>
        ${icon('search', 22)}
        <input id="pq" type="search" autocomplete="off" placeholder="Try “trade show booth”, “sales deck” or “LinkedIn ads”" value="${state.q}" />
      </form>
      <div class="chips cat-chips" role="group" aria-label="Filter by category" data-cats></div>
    </header>
    ${drafts.length ? html`<section class="card drafts rise" aria-labelledby="drafts-h">
      <div class="card-head"><h2 id="drafts-h">Continue a draft</h2><span class="tiny muted">${drafts.length} saved</span></div>
      <ul class="draft-list" data-drafts>${drafts.map((d) => html`<li>
        <a href="/requests/${d.ref}/edit" data-link class="draft-link"><span class="type-ico sm">${icon(TYPE_BY_ID[d.type_id]?.icon, 18)}</span>
          <span class="draft-txt"><strong>${d.title || 'Untitled request'}</strong><span class="tiny muted">${d.type_name} · edited ${ago(d.updated_at)}</span></span>
          ${icon('arrowRight', 18)}</a>
        <button type="button" class="icon-btn" data-del-draft="${d.ref}" aria-label="Delete draft ${d.title || d.ref}">${icon('trash', 18)}</button>
      </li>`)}</ul></section>` : ''}
    <div data-results aria-live="polite"></div>
  </div>`);

  const resultsEl = main.querySelector('[data-results]');
  const catsEl = main.querySelector('[data-cats]');
  const input = main.querySelector('#pq');

  function card(t, i) {
    const s = settings[t.id] || {};
    const approval = s.requiresApproval ?? t.requiresApproval;
    return html`<a class="type-card rise" style="--i:${Math.min(i, 10)}" href="/new/${t.id}" data-link>
      <span class="type-ico">${icon(t.icon, 22)}</span>
      <span class="type-body"><strong>${t.name}</strong><span class="type-sum">${t.summary}</span>
        <span class="type-meta"><span>${icon('clock', 14)}Usually ${s.leadDays ?? t.leadDays} business days</span>
        <span>${icon(approval ? 'checkCircle' : 'zap', 14)}${approval ? 'Manager approval' : 'No approval needed'}</span></span></span>
    </a>`;
  }
  function renderCats() {
    const chip = (id, label) => html`<button type="button" class="chip" aria-pressed="${state.cat === id}" data-cat="${id}">${label}</button>`;
    catsEl.innerHTML = String(html`${chip('', 'Everything')}${CATEGORIES.filter((c) => enabled.some((t) => t.category === c.id)).map((c) => chip(c.id, c.name))}`);
  }
  function renderResults() {
    const pool = state.cat ? enabled.filter((t) => t.category === state.cat) : enabled;
    if (state.q.trim()) {
      const found = searchTypes(state.q, pool);
      resultsEl.innerHTML = String(found.length
        ? html`<p class="small muted result-count">${found.length} match${found.length === 1 ? '' : 'es'}</p><div class="type-grid">${found.map(card)}</div>`
        : html`<div class="card">${empty('No exact match', 'Describe it in “Something else” and marketing will route it.', { art: 'sparkle', action: html`<a class="btn primary" href="/new/other" data-link>Start “Something else”</a>` })}</div>`);
      return;
    }
    const cats = CATEGORIES.filter((c) => (!state.cat || c.id === state.cat) && pool.some((t) => t.category === c.id));
    let i = 0;
    resultsEl.innerHTML = String(html`${cats.map((c) => html`<section class="cat-section" aria-labelledby="cat-${c.id}">
      <div class="cat-head"><span class="cat-ico">${icon(c.icon, 18)}</span><div><h2 id="cat-${c.id}">${c.name}</h2><p class="small muted">${c.blurb}</p></div></div>
      <div class="type-grid">${pool.filter((t) => t.category === c.id).map((t) => card(t, i++))}</div></section>`)}`);
  }
  renderCats();
  renderResults();
  if (!matchMedia('(max-width: 640px)').matches || state.q) input.focus();

  const sync = () => {
    const u = new URL(location.href);
    state.q ? u.searchParams.set('q', state.q) : u.searchParams.delete('q');
    state.cat ? u.searchParams.set('category', state.cat) : u.searchParams.delete('category');
    history.replaceState(history.state, '', u.pathname + u.search);
  };
  input.addEventListener('input', () => {
    state.q = input.value;
    renderResults();
    sync();
  });
  main.querySelector('[data-psearch]').addEventListener('submit', (e) => {
    e.preventDefault();
    const first = resultsEl.querySelector('.type-card');
    if (first) ctx.navigate(first.getAttribute('href'));
  });
  catsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.cat = b.dataset.cat;
    renderCats();
    renderResults();
    sync();
  });
  main.querySelector('[data-drafts]')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-draft]');
    if (!b) return;
    if (!(await confirmDialog('Delete this draft?', 'Its answers and files are deleted. This can’t be undone.', 'Delete draft', 'danger'))) return;
    try {
      await api.del(`/api/requests/${b.dataset.delDraft}`);
      const li = b.closest('li');
      const list = li.parentElement;
      li.remove();
      if (!list.children.length) list.closest('.drafts').remove();
      toast('Draft deleted.');
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

// =================================================================== wizard
async function wizard(main, ctx, ref) {
  main.innerHTML = String(spinner());
  const [payload, settingsMap, people] = await Promise.all([
    api.get(`/api/requests/${encodeURIComponent(ref)}`),
    loadSettings(),
    loadPeople().catch(() => []),
  ]);
  const r = payload.request;
  if (!payload.me.can_edit) {
    toast('This request can’t be edited now. Add a comment on it instead.');
    return ctx.navigate(`/requests/${r.ref}`, { replace: true });
  }
  const type = TYPE_BY_ID[r.type_id];
  if (!type) throw new Error('This request’s type no longer exists.');
  const me = store.me;
  const settings = settingsMap[type.id] || { enabled: true, requiresApproval: type.requiresApproval, leadDays: type.leadDays };
  const isDraft = r.status === 'draft';
  const needsApproval = settings.requiresApproval && !isLead();
  const today = todayYmd();
  const names = { ...Object.fromEntries(people.map((p) => [p.email, p.name])), ...payload.names };

  const s = {
    step: 0,
    title: r.title || '',
    brief: { ...(r.brief || {}) },
    due_date: r.due_date || '',
    priority: r.priority || 'normal',
    rush_reason: r.rush_reason || '',
    department: r.department || me.department || '',
    approver: r.approver_email || (me.manager_email !== me.email ? me.manager_email : '') || '',
    approverOther: false,
    files: payload.files.filter((f) => f.kind === 'reference'),
    watchers: payload.watchers || [],
    errors: {},
    linkRows: {},
    uploads: [],
    saveState: 'idle',
    savedAt: null,
    saveError: '',
    dirty: false,
  };
  if (s.approver && !people.some((p) => p.email === s.approver)) s.approverOther = true;

  const baseStepFields = BASE_FIELDS.filter((f) => f.id !== 'reference_links').map((f) => f.id);
  const refLinkField = BASE_FIELDS.find((f) => f.id === 'reference_links');
  const typeIds = new Set(type.fields.map((f) => f.id));
  const allFields = [...BASE_FIELDS, ...type.fields];
  const deps = new Set(allFields.filter((f) => f.showIf).map((f) => f.showIf.field));
  const fieldStep = (id) => (id in TOP_STEP ? TOP_STEP[id] : id === 'references' || id === 'reference_links' ? 3 : typeIds.has(id) ? 1 : 0);

  setTitle(isDraft ? `New ${type.name.toLowerCase()}` : `Edit ${r.ref}`);
  main.innerHTML = String(html`<div class="page wiz-page">
    <header class="wiz-head">
      <div class="wiz-crumbs small"><a href="${isDraft ? '/new' : `/requests/${r.ref}`}" data-link>${icon('arrowLeft', 16)}${isDraft ? 'All request types' : `Back to ${r.ref}`}</a>
        <span class="save-state" data-save aria-live="polite"></span></div>
      <div class="wiz-title"><span class="type-ico lg">${icon(type.icon, 26)}</span>
        <div><p class="eyebrow">${isDraft ? 'New request' : `Editing ${r.ref}`} · ${CATEGORIES.find((c) => c.id === type.category)?.name}</p><h1>${type.name}</h1></div></div>
      ${!isDraft ? html`<div class="wiz-banner ${r.status === 'rejected' ? 'bad' : ''}">${icon(r.status === 'rejected' ? 'alert' : 'info', 20)}<p>${
        r.status === 'rejected' ? 'This request wasn’t approved. Update it using the approver’s note, then resubmit.' :
        r.status === 'needs_info' ? 'Marketing asked a question. Update the brief here, and answer them on the request page.' :
        'This request is already submitted. Changes are saved when you press “Save changes”, and everyone involved can see them.'}</p></div>` : ''}
      <nav aria-label="Steps"><ol class="steps" data-steps></ol></nav>
      <div class="step-mobile" data-step-mobile aria-hidden="true"></div>
    </header>
    <div class="wiz">
      <form class="wiz-main card" data-form novalidate>
        <div data-stepbody></div>
        <div class="wiz-foot" data-foot></div>
      </form>
      <aside class="wiz-side" data-side aria-label="Brief summary"></aside>
    </div>
  </div>`);

  const form = main.querySelector('[data-form]');
  const body = main.querySelector('[data-stepbody]');
  const side = main.querySelector('[data-side]');

  // ----------------------------------------------------------------- derived
  const earliest = () => earliestStandardDate(type, s.brief, today, settings);
  const isRush = () => !!s.due_date && s.due_date < earliest();
  const approverValid = () => !s.approver || (EMAIL_RE.test(s.approver) && s.approver !== me.email);
  const linkFieldIds = () => allFields.filter((f) => f.type === 'links').map((f) => f.id);
  function cleanBriefForSave() {
    const out = {};
    for (const [k, v] of Object.entries(s.brief)) {
      if (v === undefined || v === '') continue;
      out[k] = Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '') : v;
      if (Array.isArray(out[k]) && !out[k].length) delete out[k];
    }
    return out;
  }
  const score = () => briefScore(type, s.brief, { refs: s.files.length, title: s.title, dueDate: s.due_date });

  function stepErrors(i) {
    const e = {};
    if (i === 0) {
      if (s.title.trim().length < 3) e.title = 'Give the request a short name.';
      for (const f of visibleFields(type, s.brief)) if (baseStepFields.includes(f.id)) { const m = fieldError(f, s.brief[f.id]); if (m) e[f.id] = m; }
    } else if (i === 1) {
      for (const f of visibleFields(type, s.brief)) if (typeIds.has(f.id)) { const m = fieldError(f, s.brief[f.id]); if (m) e[f.id] = m; }
    } else if (i === 2) {
      if (!s.due_date) e.due_date = 'When do you need it?';
      else if (s.due_date < today) e.due_date = 'That date is in the past.';
      if (isRush() && !s.rush_reason.trim()) e.rush_reason = 'This is faster than usual. Tell marketing why the date can’t move.';
      if (needsApproval && !s.approver) e.approver_email = 'Choose who approves this (usually your manager).';
      else if (s.approver && !EMAIL_RE.test(s.approver)) e.approver_email = 'Enter a full email address.';
      else if (s.approver === me.email) e.approver_email = 'Someone else needs to approve your request.';
    } else if (i === 3 && refLinkField) {
      const m = fieldError(refLinkField, s.brief.reference_links);
      if (m) e.reference_links = m;
    }
    return e;
  }
  const allErrors = () => ({ ...stepErrors(0), ...stepErrors(1), ...stepErrors(2), ...stepErrors(3) });

  // ----------------------------------------------------------------- saving
  let timer = null;
  let chain = Promise.resolve();
  function scheduleSave() {
    s.dirty = true;
    if (!isDraft) {
      // Toggle in place: re-rendering here (on a blur-triggered change) would swallow a click on the button.
      main.querySelectorAll('[data-foot] [data-savechanges]').forEach((b) => (b.disabled = false));
      return renderSaveState();
    }
    clearTimeout(timer);
    timer = setTimeout(() => queueSave(), 700);
    s.saveState = 'pending';
    renderSaveState();
  }
  function payloadForSave() {
    const p = {
      title: s.title.trim(), brief: cleanBriefForSave(), due_date: s.due_date || null, priority: s.priority,
      rush_reason: s.rush_reason, department: s.department || null,
    };
    if (approverValid() && (s.approver || '') !== (r.approver_email || '')) p.approver_email = s.approver || null;
    return p;
  }
  function queueSave() {
    clearTimeout(timer);
    timer = null;
    chain = chain.then(async () => {
      if (!s.dirty) return;
      s.dirty = false;
      s.saveState = 'saving';
      renderSaveState();
      try {
        const p = payloadForSave();
        const d = await api.patch(`/api/requests/${r.ref}`, p);
        r.approver_email = d.request.approver_email;
        s.saveState = 'saved';
        s.savedAt = Date.now();
        s.saveError = '';
      } catch (e) {
        s.dirty = true;
        s.saveState = 'error';
        s.saveError = e.message;
      }
      renderSaveState();
    });
    return chain;
  }
  function renderSaveState() {
    const el = main.querySelector('[data-save]');
    if (!el) return;
    if (!isDraft) {
      el.innerHTML = String(s.dirty ? html`<span class="ss warn">${icon('dot', 12)}Unsaved changes</span>` : '');
      return;
    }
    const map = {
      idle: html`<span class="ss">${icon('check', 14)}Draft saved automatically</span>`,
      pending: html`<span class="ss">${icon('edit', 14)}Editing…</span>`,
      saving: html`<span class="ss"><span class="spinner tiny-spin"></span>Saving…</span>`,
      saved: html`<span class="ss ok">${icon('check', 14)}Saved ${s.savedAt && Date.now() - s.savedAt < 45000 ? 'just now' : ago(new Date(s.savedAt).toISOString())}</span>`,
      error: html`<span class="ss bad">${icon('alert', 14)}Couldn’t save: ${s.saveError} <button type="button" class="link-btn" data-retry>Retry</button></span>`,
    };
    el.innerHTML = String(map[s.saveState]);
  }
  const savedTicker = setInterval(() => s.saveState === 'saved' && renderSaveState(), 30000);
  const beforeUnload = (e) => {
    if (s.dirty || timer) {
      if (isDraft) queueSave();
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  main.querySelector('[data-save]').addEventListener('click', (e) => e.target.closest('[data-retry]') && (s.dirty = true, queueSave()));

  // ----------------------------------------------------------------- fields
  function label(f, forId) {
    const inner = html`${f.label}${f.required ? html`<span class="req" aria-hidden="true"> *</span><span class="visually-hidden"> (required)</span>` : html`<span class="opt">Optional</span>`}`;
    return forId ? html`<label class="label" for="${forId}">${inner}</label>` : html`<legend class="label">${inner}</legend>`;
  }
  const helpEl = (f) => (f.help ? html`<p class="hint" id="h-${f.id}">${f.help}</p>` : '');
  const errEl = (id, msg) => html`<p class="error-text" id="e-${id}" ${msg ? '' : 'hidden'}>${icon('alert', 16)}<span>${msg || ''}</span></p>`;
  const optOf = (o) => (typeof o === 'string' ? { value: o, label: o } : o);

  function fieldHtml(f) {
    const v = s.brief[f.id];
    const err = s.errors[f.id];
    const id = `f-${f.id}`;
    const desc = [f.help ? `h-${f.id}` : '', `e-${f.id}`].filter(Boolean).join(' ');
    const a = html`data-f="${f.id}" aria-describedby="${desc}" aria-invalid="${err ? 'true' : 'false'}" ${f.required ? html`aria-required="true"` : ''}`;
    const wrap = (inner, group = false) =>
      group
        ? html`<fieldset class="field fgroup ${f.width === 'half' ? 'half' : ''}" data-field="${f.id}">${label(f)}${helpEl(f)}${inner}${errEl(f.id, err)}</fieldset>`
        : html`<div class="field ${f.width === 'half' ? 'half' : ''}" data-field="${f.id}">${label(f, id)}${helpEl(f)}${inner}${errEl(f.id, err)}</div>`;
    switch (f.type) {
      case 'text':
        return wrap(html`<input class="input" id="${id}" type="text" ${a} value="${v ?? ''}" ${f.maxLength ? html`maxlength="${f.maxLength}"` : ''} placeholder="${f.placeholder || ''}" />`);
      case 'textarea':
        return wrap(html`<textarea class="textarea" id="${id}" ${a} rows="4" ${f.maxLength ? html`maxlength="${f.maxLength}"` : ''} placeholder="${f.placeholder || ''}">${v ?? ''}</textarea>
          ${f.maxLength ? html`<span class="count" data-count="${f.id}">${(v || '').length} / ${f.maxLength}</span>` : ''}`);
      case 'select':
        return wrap(html`<select class="select" id="${id}" ${a}><option value="">Choose…</option>${(f.options || []).map(optOf).map((o) => html`<option value="${o.value}" ${v === o.value ? 'selected' : ''}>${o.label}</option>`)}</select>`);
      case 'cards': {
        const opts = (f.options || []).map(optOf);
        return wrap(html`<div class="choices ${opts.some((o) => o.hint) ? 'with-hints' : ''}" role="radiogroup" aria-describedby="${desc}">${opts.map((o, i) => html`<label class="choice">
          <input type="radio" name="r-${f.id}" ${i === 0 ? html`id="${id}"` : ''} value="${o.value}" ${v === o.value ? 'checked' : ''} data-f="${f.id}" aria-invalid="${err ? 'true' : 'false'}" />
          <span class="choice-box"><span class="choice-tick">${icon('check', 14)}</span><span class="choice-label">${o.label}</span>${o.hint ? html`<span class="choice-hint">${o.hint}</span>` : ''}</span></label>`)}</div>`, true);
      }
      case 'multi': {
        const sel = Array.isArray(v) ? v : [];
        return wrap(html`<div class="chips" ${''}>${(f.options || []).map(optOf).map((o, i) => html`<label class="chip"><input type="checkbox" ${i === 0 ? html`id="${id}"` : ''} value="${o.value}" ${sel.includes(o.value) ? 'checked' : ''} data-f="${f.id}" aria-describedby="${desc}" />${icon('check', 14)}<span>${o.label}</span></label>`)}</div>`, true);
      }
      case 'date':
        return wrap(html`<input class="input date" id="${id}" type="date" min="${today}" ${a} value="${v ?? ''}" />`);
      case 'daterange': {
        const dv = v || {};
        return wrap(html`<div class="pair"><div class="sub"><label class="small muted" for="${id}">Start</label><input class="input date" id="${id}" type="date" min="${today}" data-f="${f.id}" data-part="start" value="${dv.start || ''}" aria-describedby="${desc}" aria-invalid="${err ? 'true' : 'false'}" /></div>
          <div class="sub"><label class="small muted" for="${id}-end">End</label><input class="input date" id="${id}-end" type="date" min="${dv.start || today}" data-f="${f.id}" data-part="end" value="${dv.end || ''}" aria-describedby="${desc}" aria-invalid="${err ? 'true' : 'false'}" /></div></div>`, true);
      }
      case 'number':
        return wrap(html`<input class="input num" id="${id}" type="number" inputmode="numeric" ${f.min !== undefined ? html`min="${f.min}"` : ''} ${f.max !== undefined ? html`max="${f.max}"` : ''} ${a} value="${v ?? ''}" />`);
      case 'money':
        return wrap(html`<div class="money"><span aria-hidden="true">$</span><input class="input" id="${id}" type="number" inputmode="decimal" min="0" step="any" ${a} value="${v ?? ''}" placeholder="0" /></div>`);
      case 'url':
        return wrap(html`<input class="input" id="${id}" type="url" inputmode="url" ${a} value="${v ?? ''}" placeholder="https://" />`);
      case 'links': {
        const rows = s.linkRows[f.id] || (Array.isArray(v) && v.length ? [...v] : ['']);
        s.linkRows[f.id] = rows;
        return wrap(html`<div class="links-list">${rows.map((x, i) => html`<div class="link-row"><span class="link-ico">${icon('link', 16)}</span>
          <input class="input" type="url" inputmode="url" ${i === 0 ? html`id="${id}"` : ''} data-f="${f.id}" data-part="${i}" value="${x}" placeholder="https://" aria-label="Link ${i + 1}" aria-describedby="${desc}" />
          ${rows.length > 1 ? html`<button type="button" class="icon-btn" data-link-del="${f.id}:${i}" aria-label="Remove link ${i + 1}">${icon('x', 18)}</button>` : ''}</div>`)}
          <button type="button" class="btn sm ghost add-link" data-link-add="${f.id}">${icon('plus', 16)}Add another link</button></div>`, true);
      }
      case 'toggle':
        return html`<div class="field" data-field="${f.id}"><label class="switch"><input type="checkbox" role="switch" id="${id}" data-f="${f.id}" ${v ? 'checked' : ''} aria-describedby="${desc}" /><span></span>${f.label}</label>${helpEl(f)}${errEl(f.id, err)}</div>`;
      case 'address': {
        const av = v || {};
        const pid = (p) => (p === 'name' ? id : `${id}-${p}`);
        const part = (p, lab, ac, cls = '') => html`<div class="sub ${cls}"><label class="small muted" for="${pid(p)}">${lab}</label><input class="input" id="${pid(p)}" type="text" autocomplete="${ac}" data-f="${f.id}" data-part="${p}" value="${av[p] || ''}" aria-describedby="${desc}" /></div>`;
        return wrap(html`<div class="address">${part('name', 'Recipient or company', 'organization', 'wide')}${part('line1', 'Street address', 'address-line1', 'wide')}${part('line2', 'Apt, suite, booth (optional)', 'address-line2', 'wide')}
          ${part('city', 'City', 'address-level2')}${part('region', 'State / region', 'address-level1')}${part('postal', 'ZIP / postcode', 'postal-code')}${part('country', 'Country', 'country-name')}${part('phone', 'Phone for the courier (optional)', 'tel', 'wide')}</div>`, true);
      }
      default:
        return '';
    }
  }
  function readField(f) {
    const els = [...form.querySelectorAll(`[data-f="${f.id}"]`)];
    if (!els.length) return s.brief[f.id];
    switch (f.type) {
      case 'number': case 'money': return els[0].value === '' ? undefined : Number(els[0].value);
      case 'cards': return els.find((e) => e.checked)?.value;
      case 'multi': { const v = els.filter((e) => e.checked).map((e) => e.value); return v.length ? v : undefined; }
      case 'toggle': return els[0].checked;
      case 'daterange': {
        const o = Object.fromEntries(els.map((e) => [e.dataset.part, e.value]));
        return o.start || o.end ? o : undefined;
      }
      case 'address': {
        const o = Object.fromEntries(els.map((e) => [e.dataset.part, e.value]).filter(([, x]) => x !== ''));
        return Object.keys(o).length ? o : undefined;
      }
      case 'links': {
        const rows = els.map((e) => e.value);
        s.linkRows[f.id] = rows;
        const v = rows.map((x) => x.trim()).filter(Boolean);
        return v.length ? v : undefined;
      }
      default: return els[0].value.trim() === '' ? undefined : els[0].value;
    }
  }
  function setFieldError(id, msg) {
    if (msg) s.errors[id] = msg;
    else delete s.errors[id];
    const e = form.querySelector(`#e-${CSS.escape(id)}`);
    if (e) {
      e.hidden = !msg;
      e.querySelector('span').textContent = msg || '';
    }
    form.querySelectorAll(`[data-f="${id}"], [data-top="${id}"]`).forEach((el) => el.setAttribute('aria-invalid', msg ? 'true' : 'false'));
    form.querySelector(`[data-field="${id}"]`)?.classList.toggle('has-error', !!msg);
  }

  // ----------------------------------------------------------------- steps
  function renderSteps() {
    const errs = s.step === 4 ? allErrors() : null;
    main.querySelector('[data-steps]').innerHTML = String(html`${STEPS.map((st, i) => {
      const done = i < s.step || (i < 4 && Object.keys(stepErrors(i)).length === 0 && (i !== 0 || s.title));
      const bad = errs && Object.keys(errs).some((k) => fieldStep(k) === i);
      return html`<li><button type="button" class="step-btn ${i === s.step ? 'current' : ''} ${done && i !== s.step ? 'done' : ''} ${bad ? 'bad' : ''}" data-goto="${i}" ${i === s.step ? html`aria-current="step"` : ''}>
        <span class="step-n">${done && i !== s.step && !bad ? icon('check', 14) : i + 1}</span><span class="step-l">${st.label}</span></button></li>`;
    })}`);
    main.querySelector('[data-step-mobile]').innerHTML = String(html`<span>Step ${s.step + 1} of ${STEPS.length} · <strong>${STEPS[s.step].label}</strong></span><span class="bar"><span style="--w:${((s.step + 1) / STEPS.length) * 100}%"></span></span>`);
  }

  function stepFields(ids) {
    const vis = visibleFields(type, s.brief).filter((f) => ids.includes(f.id));
    return html`<div class="fields">${vis.map(fieldHtml)}</div>`;
  }

  function errorSummary() {
    const ids = Object.keys(s.errors).filter((k) => fieldStep(k) === s.step);
    if (!ids.length) return '';
    return html`<div class="err-summary" role="alert">${icon('alert', 18)}<p>${ids.length === 1 ? 'One answer needs a look.' : `${ids.length} answers need a look.`}</p></div>`;
  }

  function renderBody() {
    const st = STEPS[s.step];
    let inner;
    if (s.step === 0) {
      inner = html`<div class="field" data-field="title"><label class="label" for="f-title">Give it a short name<span class="req" aria-hidden="true"> *</span><span class="visually-hidden"> (required)</span></label>
          <p class="hint" id="h-title">How you’d refer to it in a meeting. It’s the title everyone sees.</p>
          <input class="input input-lg" id="f-title" type="text" data-top="title" maxlength="160" value="${s.title}" placeholder="${placeholderTitle(type)}" aria-describedby="h-title e-title" aria-invalid="${s.errors.title ? 'true' : 'false'}" aria-required="true" />
          ${errEl('title', s.errors.title)}</div>
        ${stepFields(baseStepFields)}`;
    } else if (s.step === 1) {
      inner = type.fields.length ? stepFields([...typeIds]) : html`<p class="muted">No extra questions for this one. Continue.</p>`;
    } else if (s.step === 2) {
      inner = timingHtml();
    } else if (s.step === 3) {
      inner = filesHtml();
    } else {
      inner = reviewHtml();
    }
    body.innerHTML = String(html`<div class="step-intro"><p class="eyebrow">Step ${s.step + 1} of ${STEPS.length}</p><h2 id="step-h" tabindex="-1">${st.title}</h2><p class="muted">${st.lede}</p></div>
      ${errorSummary()}${inner}`);
    renderFoot();
  }

  function renderFoot() {
    const last = s.step === STEPS.length - 1;
    const foot = main.querySelector('[data-foot]');
    let primary;
    if (!last) primary = html`<button type="submit" class="btn primary lg" data-next>Continue${icon('arrowRight', 18)}</button>`;
    else if (isDraft) primary = html`<button type="submit" class="btn lime lg" data-submit>${icon('check', 18)}${needsApproval ? 'Submit for approval' : 'Submit to marketing'}</button>`;
    else if (r.status === 'rejected') primary = html`<button type="submit" class="btn lime lg" data-resubmit>${icon('refresh', 18)}Save and resubmit</button>`;
    else primary = html`<button type="submit" class="btn primary lg" data-savechanges>${icon('check', 18)}Save changes</button>`;
    foot.innerHTML = String(html`${s.step > 0 ? html`<button type="button" class="btn ghost" data-back>${icon('arrowLeft', 18)}Back</button>` : html`<span></span>`}
      <div class="btn-row">${!isDraft && !last ? html`<button type="button" class="btn" data-savechanges ${s.dirty ? '' : 'disabled'}>Save changes</button>` : ''}${primary}</div>`);
  }

  // ----------------------------------------------------------------- timing step
  function approverOptions() {
    const others = people.filter((p) => p.email !== me.email);
    const approvers = others.filter((p) => p.is_approver);
    const rest = others.filter((p) => !p.is_approver);
    const opt = (p) => html`<option value="${p.email}" ${s.approver === p.email ? 'selected' : ''}>${p.name}${p.title ? ` · ${p.title}` : ''}${p.email === me.manager_email ? ' (your manager)' : ''}</option>`;
    return html`<option value="">Choose an approver…</option>
      ${approvers.length ? html`<optgroup label="Approvers">${approvers.map(opt)}</optgroup>` : ''}
      ${rest.length ? html`<optgroup label="Everyone else">${rest.map(opt)}</optgroup>` : ''}
      <option value="__other" ${s.approverOther ? 'selected' : ''}>Someone else (enter their email)…</option>`;
  }
  function timingHtml() {
    const early = earliest();
    const lead = leadDaysFor(type, s.brief, settings.leadDays);
    const rush = isRush();
    return html`<div class="fields">
      <div class="field" data-field="due_date">
        <label class="label" for="f-due_date">When do you need it?<span class="req" aria-hidden="true"> *</span><span class="visually-hidden"> (required)</span></label>
        <p class="hint" id="h-due">The date it must be in your hands, ready to use.</p>
        <div class="due-row"><input class="input date" id="f-due_date" type="date" min="${today}" data-top="due_date" value="${s.due_date}" aria-describedby="h-due turn e-due_date" aria-invalid="${s.errors.due_date ? 'true' : 'false'}" aria-required="true" />
          ${!s.due_date || s.due_date < early ? html`<button type="button" class="btn sm" data-use-date="${early}">Use ${fmtDate(early)}</button>` : ''}</div>
        <div class="turnaround ${rush ? 'rush' : s.due_date ? 'ok' : ''}" id="turn">
          ${icon(rush ? 'zap' : 'clock', 18)}
          <p>${rush
            ? html`<strong>That’s a rush.</strong> ${type.name} usually takes ${lead} business days${needsApproval ? ' plus a day for approval' : ''}, so the standard date is <strong>${fmtDate(early, { weekday: true })}</strong>. Marketing will try; tell them why the date can’t move.`
            : html`<strong>Standard turnaround:</strong> ${lead} business days${needsApproval ? ' after approval' : ''}. Ready by <strong>${fmtDate(early, { weekday: true })}</strong> if you submit today.${s.due_date ? html` Your date gives the team ${icon('check', 14)} enough time.` : ''}`}</p>
        </div>
        ${errEl('due_date', s.errors.due_date)}
      </div>
      ${rush ? html`<div class="field" data-field="rush_reason"><label class="label" for="f-rush_reason">Why can’t the date move?<span class="req" aria-hidden="true"> *</span><span class="visually-hidden"> (required)</span></label>
        <textarea class="textarea short" id="f-rush_reason" data-top="rush_reason" rows="2" maxlength="1000" placeholder="e.g. The conference is on the 14th and the booth ships on the 7th." aria-describedby="e-rush_reason" aria-invalid="${s.errors.rush_reason ? 'true' : 'false'}">${s.rush_reason}</textarea>
        ${errEl('rush_reason', s.errors.rush_reason)}</div>` : ''}
      <fieldset class="field fgroup" data-field="priority"><legend class="label">How important is it?</legend>
        <div class="choices with-hints four" role="radiogroup">${PRIORITIES.map((p) => html`<label class="choice prio-${p.value}"><input type="radio" name="priority" value="${p.value}" data-top="priority" ${s.priority === p.value ? 'checked' : ''} />
          <span class="choice-box"><span class="choice-tick">${icon('check', 14)}</span><span class="choice-label">${p.label}</span><span class="choice-hint">${p.hint}</span></span></label>`)}</div></fieldset>
      <div class="field" data-field="approver_email">
        <label class="label" for="f-approver_email">Who approves this?${needsApproval ? html`<span class="req" aria-hidden="true"> *</span><span class="visually-hidden"> (required)</span>` : html`<span class="opt">Not needed</span>`}</label>
        ${needsApproval
          ? html`<p class="hint" id="h-appr">Usually your manager. They get an email with your brief and approve it in one click.</p>
            <select class="select" id="f-approver_email" data-top="approver_select" aria-describedby="h-appr e-approver_email" aria-invalid="${s.errors.approver_email ? 'true' : 'false'}">${approverOptions()}</select>
            ${s.approverOther ? html`<input class="input mt" id="f-approver_other" type="email" data-top="approver_other" value="${s.approver}" placeholder="name@overyondr.com" aria-label="Approver’s email" aria-describedby="e-approver_email" />` : ''}
            ${s.approver && EMAIL_RE.test(s.approver) ? html`<div class="approver-chip">${avatar(s.approver, nameOf(s.approver, names), 'sm')}<span><strong>${nameOf(s.approver, names)}</strong> will be asked to approve.</span></div>` : ''}
            ${!me.manager_email ? html`<p class="hint">Tip: set your manager in <a href="/settings" data-link>Settings</a> and we’ll fill this in next time.</p>` : ''}`
          : html`<div class="turnaround ok">${icon('zap', 18)}<p>${isLead() ? 'You’re a marketing lead, so this goes straight to the marketing queue.' : `${type.name} requests don’t need manager approval. It goes straight to the marketing queue.`}</p></div>`}
        ${errEl('approver_email', s.errors.approver_email)}
      </div>
      <div class="field half" data-field="department"><label class="label" for="f-department">Your team<span class="opt">Optional</span></label>
        <select class="select" id="f-department" data-top="department"><option value="">Choose…</option>${DEPARTMENTS.map((d) => html`<option ${s.department === d ? 'selected' : ''}>${d}</option>`)}</select></div>
      <fieldset class="field fgroup" data-field="watchers"><legend class="label">Who else should follow it?<span class="opt">Optional</span></legend>
        <p class="hint" id="h-watch">They get updates and can join the conversation.</p>
        <div class="watch-add"><input class="input" id="f-watch" type="email" list="people-list" placeholder="Name or email" aria-describedby="h-watch" autocomplete="off" />
          <button type="button" class="btn" data-watch-add>${icon('plus', 16)}Add</button></div>
        <datalist id="people-list">${people.filter((p) => p.email !== me.email).map((p) => html`<option value="${p.email}">${p.name}</option>`)}</datalist>
        <ul class="watchers" data-watchers>${watchersHtml()}</ul>
      </fieldset>
    </div>`;
  }
  function watchersHtml() {
    return html`${s.watchers.map((w) => html`<li class="watcher">${avatar(w.email, nameOf(w.email, names), 'sm')}<span>${nameOf(w.email, names)}${w.email === me.email ? ' (you)' : ''}</span>
      <button type="button" class="icon-btn" data-watch-del="${w.email}" aria-label="Remove ${nameOf(w.email, names)}">${icon('x', 16)}</button></li>`)}`;
  }

  // ----------------------------------------------------------------- files step
  function filesHtml() {
    return html`<div class="fields">
      <div class="field" data-field="references">
        <label class="dropzone" for="f-files" data-drop>
          <input id="f-files" type="file" multiple class="visually-hidden" data-file-input />
          <span class="dz-ico">${icon('upload', 26)}</span>
          <strong>Drop files here, or <span class="u">browse</span></strong>
          <span class="small muted">Drafts, examples, logos, data, old versions. Up to 95 MB each; share a Google Drive or Dropbox link for bigger files.</span>
        </label>
        <ul class="uploads" data-uploads>${uploadsHtml()}</ul>
        <ul class="file-list" data-files>${filesListHtml()}</ul>
      </div>
      ${refLinkField ? fieldHtml(refLinkField) : ''}
    </div>`;
  }
  function uploadsHtml() {
    return html`${s.uploads.map((u) => html`<li class="upload ${u.error ? 'failed' : ''}">${icon(u.error ? 'alert' : 'upload', 18)}<span class="up-name">${u.name}</span>
      ${u.error ? html`<span class="small bad-text">${u.error}</span>` : html`<span class="up-bar" role="progressbar" aria-label="Uploading ${u.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(u.p * 100)}"><span style="--w:${Math.round(u.p * 100)}%"></span></span>`}</li>`)}`;
  }
  function filesListHtml() {
    return html`${s.files.map((f) => html`<li class="file">
      ${/^image\/(png|jpeg|gif|webp|avif)$/.test(f.content_type || '') ? html`<img class="thumb" src="/api/files/${f.id}?inline=1" alt="" loading="lazy" />` : html`<span class="thumb ico">${icon('file', 20)}</span>`}
      <span class="file-txt"><a href="/api/files/${f.id}" download>${f.name}</a><span class="tiny muted">${bytes(f.size)} · added ${ago(f.created_at)}</span></span>
      <button type="button" class="icon-btn" data-file-del="${f.id}" aria-label="Remove ${f.name}">${icon('trash', 18)}</button></li>`)}`;
  }
  async function addFiles(list) {
    for (const file of list) {
      if (file.size > MAX_UPLOAD) {
        toast(`“${file.name}” is over 95 MB. Share a Drive or Dropbox link instead.`, { error: true, timeout: 8000 });
        continue;
      }
      if (!file.size) {
        toast(`“${file.name}” is empty.`, { error: true });
        continue;
      }
      const u = { name: file.name, p: 0 };
      s.uploads.push(u);
      paintUploads();
      try {
        const d = await upload(r.ref, file, { kind: 'reference', onProgress: (p) => { u.p = p; paintUploads(); } });
        s.files = d.files.filter((f) => f.kind === 'reference');
        s.uploads = s.uploads.filter((x) => x !== u);
        paintUploads();
        paintFiles();
        renderSide();
      } catch (e) {
        u.error = e.message;
        paintUploads();
        setTimeout(() => { s.uploads = s.uploads.filter((x) => x !== u); paintUploads(); }, 8000);
      }
    }
  }
  const paintUploads = () => { const el = form.querySelector('[data-uploads]'); if (el) el.innerHTML = String(uploadsHtml()); };
  const paintFiles = () => { const el = form.querySelector('[data-files]'); if (el) el.innerHTML = String(filesListHtml()); };

  // ----------------------------------------------------------------- review step
  function reviewHtml() {
    const errs = allErrors();
    const sec = (i, title, rows) => html`<section class="sum-sec"><div class="sum-head"><h3>${title}</h3><button type="button" class="btn sm ghost" data-goto="${i}">${icon('edit', 16)}Edit</button></div>
      <dl class="sum">${rows.filter(Boolean)}</dl></section>`;
    const row = (lab, val, id) => {
      const e = errs[id];
      if (!val && !e) return '';
      return html`<div class="sum-row ${e ? 'bad' : ''}"><dt>${lab}</dt><dd>${e ? html`<button type="button" class="link-btn bad-text" data-fix="${id}">${icon('alert', 14)}${e}</button>` : val}</dd></div>`;
    };
    const fieldRows = (ids) => visibleFields(type, s.brief).filter((f) => ids.includes(f.id)).map((f) => row(f.label.replace(/\?$/, ''), formatAnswer(f, s.brief[f.id]), f.id));
    const sc = score();
    const nErr = Object.keys(errs).length;
    return html`
      ${nErr ? html`<div class="err-summary" role="alert">${icon('alert', 18)}<p>${nErr === 1 ? 'One answer needs a look before you submit.' : `${nErr} answers need a look before you submit.`} They’re marked below.</p></div>` : ''}
      <div class="review-top">
        <div class="meter-card ${sc.score >= 80 ? 'great' : sc.score >= 55 ? 'good' : 'low'}">
          <div class="meter-n"><span>${sc.score}</span><small>/100</small></div>
          <div><strong>Brief strength: ${strengthWord(sc.score)}</strong><p class="small muted">${sc.score >= 80 ? 'Marketing has what they need to start.' : 'Optional answers below can save a round of questions.'}</p></div>
        </div>
        <ol class="next-steps compact">${nextSteps()}</ol>
      </div>
      ${sec(0, 'The brief', [row('Title', s.title, 'title'), ...fieldRows(baseStepFields)])}
      ${type.fields.length ? sec(1, 'Details', fieldRows([...typeIds])) : ''}
      ${sec(2, 'Timing & people', [
        row('Needed by', s.due_date ? fmtDate(s.due_date, { weekday: true, year: true }) + (isRush() ? ' · rush' : '') : '', 'due_date'),
        isRush() ? row('Why rush', s.rush_reason, 'rush_reason') : '',
        row('Priority', PRIORITIES.find((p) => p.value === s.priority)?.label, 'priority'),
        needsApproval ? row('Approver', s.approver ? nameOf(s.approver, names) : '', 'approver_email') : row('Approval', 'Not needed', 'x'),
        row('Team', s.department, 'department'),
        row('Following', s.watchers.map((w) => nameOf(w.email, names)).join(', '), 'watchers'),
      ])}
      ${sec(3, 'Files & links', [
        row('Files', s.files.map((f) => f.name).join('\n') || 'None', 'references'),
        refLinkField ? row('Links', formatAnswer(refLinkField, s.brief.reference_links), 'reference_links') : '',
      ])}`;
  }
  const strengthWord = (n) => (n >= 80 ? 'great' : n >= 55 ? 'good' : n >= 30 ? 'getting there' : 'just started');
  function nextSteps() {
    const steps = [
      needsApproval ? `${s.approver ? nameOf(s.approver, names) : 'Your approver'} approves it` : 'Goes straight to marketing',
      'Marketing assigns a creator',
      'They create it and ask questions here',
      'You review and accept',
      'Delivered',
    ];
    return html`${steps.map((t, i) => html`<li><span class="ns-dot">${i + 1}</span>${t}</li>`)}`;
  }

  // ----------------------------------------------------------------- side panel
  function renderSide() {
    const sc = score();
    const early = earliest();
    const lead = leadDaysFor(type, s.brief, settings.leadDays);
    side.innerHTML = String(html`<div class="side-card card">
      <div class="side-type"><span class="type-ico">${icon(type.icon, 20)}</span><div><strong>${type.name}</strong>${isDraft ? html`<button type="button" class="link-btn small" data-change-type>Change type</button>` : html`<span class="tiny muted">${r.ref}</span>`}</div></div>
      <div class="strength ${sc.score >= 80 ? 'great' : sc.score >= 55 ? 'good' : 'low'}">
        <div class="spread"><span class="small"><strong>Brief strength</strong></span><span class="small mono"><strong>${sc.score}</strong>/100</span></div>
        <div class="bar" role="meter" aria-label="Brief strength" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sc.score}"><span style="--w:${sc.score}%"></span></div>
        <p class="tiny muted">${sc.score >= 80 ? 'Great brief. Marketing can start right away.' : 'The more complete, the fewer questions later.'}</p>
      </div>
      ${sc.tips.length ? html`<ul class="tips">${sc.tips.map((t) => html`<li><button type="button" class="tip" data-fix="${t.field}">${icon('sparkle', 16)}<span>${t.text}</span></button></li>`)}</ul>` : ''}
      <div class="side-sec"><p class="side-h">${icon('clock', 16)}Turnaround</p>
        <p class="small">Usually <strong>${lead} business days</strong>${needsApproval ? ' after approval' : ''}. Submit today → ready by <strong>${fmtDate(early)}</strong>.</p>
        ${s.due_date ? html`<p class="small ${isRush() ? 'rush-text' : ''}">You need it by <strong>${fmtDate(s.due_date, { weekday: true })}</strong>${isRush() ? ' (rush)' : ''}.</p>` : ''}</div>
      <div class="side-sec"><p class="side-h">${icon('route', 16)}What happens next</p><ol class="next-steps">${nextSteps()}</ol></div>
      <p class="tiny muted deliver">${icon('checkCircle', 14)}You’ll get: ${type.deliverables}</p>
    </div>`);
  }

  // ----------------------------------------------------------------- navigation
  function go(i, focusId) {
    s.step = Math.max(0, Math.min(STEPS.length - 1, i));
    renderSteps();
    renderBody();
    renderSide();
    if (focusId) focusField(focusId);
    else {
      main.querySelector('.wiz-head').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      main.querySelector('#step-h')?.focus({ preventScroll: true });
    }
    if (isDraft && s.dirty) queueSave();
  }
  function focusField(id) {
    const step = fieldStep(id);
    if (step !== s.step) return go(step, id);
    const el = form.querySelector(`#f-${CSS.escape(id)}`) || form.querySelector(`[data-f="${id}"]`) || form.querySelector(`[data-field="${id}"] input, [data-field="${id}"] select, [data-field="${id}"] textarea`) || form.querySelector(`[data-field="${id}"] label`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }
  function rerenderKeepFocus() {
    const a = document.activeElement;
    const id = a && form.contains(a) ? a.id : null;
    const sel = a && 'selectionStart' in a ? (() => { try { return [a.selectionStart, a.selectionEnd]; } catch { return null; } })() : null;
    const val = a && (a.type === 'radio' || a.type === 'checkbox') ? a.value : null;
    const f = a?.dataset?.f;
    renderBody();
    let el = id ? form.querySelector(`#${CSS.escape(id)}`) : null;
    if (!el && f && val !== null) el = form.querySelector(`[data-f="${f}"][value="${CSS.escape(val)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && 'setSelectionRange' in el) try { el.setSelectionRange(sel[0], sel[1]); } catch {}
    }
  }

  // ----------------------------------------------------------------- events
  function onInput(e) {
    const t = e.target;
    if (t.dataset.f) {
      const f = allFields.find((x) => x.id === t.dataset.f);
      if (!f) return;
      const v = readField(f);
      if (v === undefined) delete s.brief[f.id];
      else s.brief[f.id] = v;
      if (s.errors[f.id] && !fieldError(f, v)) setFieldError(f.id, '');
      if (f.maxLength) { const c = form.querySelector(`[data-count="${f.id}"]`); if (c) c.textContent = `${(t.value || '').length} / ${f.maxLength}`; }
      if (f.type === 'daterange' && t.dataset.part === 'start') { const end = form.querySelector(`[data-f="${f.id}"][data-part="end"]`); if (end) end.min = t.value || today; }
      scheduleSave();
      renderSide();
      if (e.type === 'change' && deps.has(f.id)) rerenderKeepFocus();
      return;
    }
    const top = t.dataset.top;
    if (!top) return;
    if (top === 'title') { s.title = t.value; if (s.errors.title && t.value.trim().length >= 3) setFieldError('title', ''); }
    else if (top === 'due_date') { s.due_date = t.value; if (e.type === 'change') { delete s.errors.due_date; rerenderKeepFocus(); } }
    else if (top === 'rush_reason') { s.rush_reason = t.value; if (t.value.trim()) setFieldError('rush_reason', ''); }
    else if (top === 'priority') s.priority = t.value;
    else if (top === 'department') s.department = t.value;
    else if (top === 'approver_select') {
      if (t.value === '__other') { s.approverOther = true; s.approver = ''; }
      else { s.approverOther = false; s.approver = t.value; }
      delete s.errors.approver_email;
      if (e.type === 'change') { rerenderKeepFocus(); if (s.approverOther) form.querySelector('#f-approver_other')?.focus(); }
    } else if (top === 'approver_other') { s.approver = t.value.trim().toLowerCase(); }
    scheduleSave();
    renderSide();
  }
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);

  // Validate on blur.
  form.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.dataset.f) {
      const group = t.closest('[data-field]');
      if (group && group.contains(e.relatedTarget)) return;
      const f = allFields.find((x) => x.id === t.dataset.f);
      if (f && f.type !== 'cards' && f.type !== 'multi') setFieldError(f.id, fieldError(f, s.brief[f.id]));
    } else if (t.dataset.top === 'title' && s.title && s.title.trim().length < 3) setFieldError('title', 'Give the request a short name.');
    else if (t.dataset.top === 'approver_other' && s.approver && !EMAIL_RE.test(s.approver)) setFieldError('approver_email', 'Enter a full email address.');
  });

  form.addEventListener('click', async (e) => {
    const b = e.target.closest('button, [data-goto]');
    if (!b) return;
    if (b.dataset.goto !== undefined) return go(Number(b.dataset.goto));
    if (b.dataset.fix) return focusField(b.dataset.fix);
    if ('back' in b.dataset) return go(s.step - 1);
    if (b.dataset.useDate) { s.due_date = b.dataset.useDate; delete s.errors.due_date; scheduleSave(); renderBody(); renderSide(); return focusField('due_date'); }
    if (b.dataset.linkAdd) {
      const id = b.dataset.linkAdd;
      s.linkRows[id] = [...(s.linkRows[id] || ['']), ''];
      rerenderKeepFocus();
      const rows = form.querySelectorAll(`[data-f="${id}"]`);
      rows[rows.length - 1]?.focus();
      return;
    }
    if (b.dataset.linkDel) {
      const [id, i] = b.dataset.linkDel.split(':');
      const rows = s.linkRows[id] || [];
      rows.splice(Number(i), 1);
      const v = rows.map((x) => x.trim()).filter(Boolean);
      if (v.length) s.brief[id] = v; else delete s.brief[id];
      scheduleSave();
      rerenderKeepFocus();
      form.querySelector(`[data-f="${id}"]`)?.focus();
      return renderSide();
    }
    if ('watchAdd' in b.dataset) return addWatcher();
    if (b.dataset.watchDel) {
      try {
        const d = await api.del(`/api/requests/${r.ref}/watchers?email=${encodeURIComponent(b.dataset.watchDel)}`);
        s.watchers = d.watchers;
        form.querySelector('[data-watchers]').innerHTML = String(watchersHtml());
        form.querySelector('#f-watch')?.focus();
      } catch (err) { toast(err.message, { error: true }); }
      return;
    }
    if (b.dataset.fileDel) {
      try {
        const d = await api.del(`/api/files/${b.dataset.fileDel}`);
        s.files = d.files.filter((f) => f.kind === 'reference');
        paintFiles();
        renderSide();
        toast('File removed.');
      } catch (err) { toast(err.message, { error: true }); }
      return;
    }
    if ('savechanges' in b.dataset && b.type === 'button') return saveChanges(false);
  });
  form.addEventListener('keydown', (e) => {
    if (e.target.id === 'f-watch' && e.key === 'Enter') { e.preventDefault(); addWatcher(); }
  });
  async function addWatcher() {
    const input = form.querySelector('#f-watch');
    const email = input.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { toast('Enter a Yondr email address.', { error: true }); return input.focus(); }
    try {
      const d = await api.post(`/api/requests/${r.ref}/watchers`, { email });
      s.watchers = d.watchers;
      Object.assign(names, d.names);
      form.querySelector('[data-watchers]').innerHTML = String(watchersHtml());
      input.value = '';
      input.focus();
    } catch (err) { toast(err.message, { error: true }); }
  }

  // Drag and drop.
  form.addEventListener('dragover', (e) => {
    const dz = e.target.closest('[data-drop]');
    if (!dz) return;
    e.preventDefault();
    dz.classList.add('over');
  });
  form.addEventListener('dragleave', (e) => e.target.closest('[data-drop]')?.classList.remove('over'));
  form.addEventListener('drop', (e) => {
    const dz = e.target.closest('[data-drop]');
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove('over');
    addFiles([...(e.dataTransfer?.files || [])]);
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('[data-file-input]')) {
      addFiles([...e.target.files]);
      e.target.value = '';
    }
  });

  main.querySelector('[data-steps]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) go(Number(b.dataset.goto));
  });
  side.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fix) return focusField(b.dataset.fix);
    if ('changeType' in b.dataset) {
      const v = await dialog({
        title: 'Change the type of request?',
        text: 'Each kind of work has its own questions, so you’ll start a new brief. Keep this one as a draft, or delete it.',
        body: html`<label class="checkbox"><input type="checkbox" name="del" /> Delete this draft</label>`,
        confirm: 'Choose another type',
      });
      if (v === null) return;
      if (v.del) { clearTimeout(timer); s.dirty = false; await api.del(`/api/requests/${r.ref}`).catch(() => {}); }
      else await queueSave();
      ctx.navigate('/new');
    }
  });

  // Continue / submit.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (s.step < STEPS.length - 1) {
      const errs = stepErrors(s.step);
      // Clear old errors for this step, then show the current ones.
      for (const k of Object.keys(s.errors)) if (fieldStep(k) === s.step) delete s.errors[k];
      Object.assign(s.errors, errs);
      if (Object.keys(errs).length) {
        renderBody();
        renderSteps();
        return focusField(Object.keys(errs)[0]);
      }
      return go(s.step + 1);
    }
    if (!isDraft) return saveChanges(r.status === 'rejected');
    await submit();
  });

  function applyServerErrors(errs) {
    s.errors = { ...errs };
    const first = Object.keys(errs).sort((a, b) => fieldStep(a) - fieldStep(b))[0];
    go(fieldStep(first), first);
  }

  async function submit() {
    const errs = allErrors();
    if (Object.keys(errs).length) {
      s.errors = errs;
      renderBody();
      renderSteps();
      const first = Object.keys(errs).sort((a, b) => fieldStep(a) - fieldStep(b))[0];
      toast('A few answers need a look first.', { error: true });
      return go(fieldStep(first), first);
    }
    const btn = form.querySelector('[data-submit]');
    btn.disabled = true;
    btn.innerHTML = String(html`<span class="spinner"></span>Submitting…`);
    try {
      s.dirty = true;
      await queueSave();
      if (s.saveState === 'error') throw new ApiError(400, s.saveError);
      const d = await api.post(`/api/requests/${r.ref}/actions/submit`, {});
      s.dirty = false;
      cleanup();
      const to = d.request.status === 'pending_approval' ? `Sent to ${nameOf(d.request.approver_email, d.names)} for approval.` : 'Sent to the marketing team.';
      toast(`${d.request.ref} submitted. ${to} We’ll keep you posted.`, { timeout: 7000 });
      ctx.refreshCounts?.();
      ctx.navigate(`/requests/${d.request.ref}`, { replace: true });
    } catch (err) {
      btn.disabled = false;
      renderFoot();
      if (err.status === 422 && err.data?.errors) {
        toast(err.message, { error: true });
        applyServerErrors(err.data.errors);
      } else toast(err.message, { error: true });
    }
  }

  async function saveChanges(resubmit) {
    const errs = resubmit ? allErrors() : { ...stepErrors(0), ...stepErrors(1) };
    if (Object.keys(errs).length) {
      s.errors = errs;
      const first = Object.keys(errs).sort((a, b) => fieldStep(a) - fieldStep(b))[0];
      toast('A few answers need a look first.', { error: true });
      return go(fieldStep(first), first);
    }
    const btns = form.querySelectorAll('[data-savechanges], [data-resubmit]');
    btns.forEach((b) => (b.disabled = true));
    try {
      const p = payloadForSave();
      await api.patch(`/api/requests/${r.ref}`, p);
      s.dirty = false;
      if (resubmit) await api.post(`/api/requests/${r.ref}/actions/resubmit`, {});
      cleanup();
      toast(resubmit ? `${r.ref} resubmitted for approval.` : 'Changes saved. Everyone involved can see them.');
      ctx.refreshCounts?.();
      ctx.navigate(`/requests/${r.ref}`);
    } catch (err) {
      btns.forEach((b) => (b.disabled = false));
      if (err.status === 422 && err.data?.errors) applyServerErrors(err.data.errors);
      toast(err.message, { error: true });
    }
  }

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearInterval(savedTicker);
    window.removeEventListener('beforeunload', beforeUnload);
    if (isDraft && (s.dirty || timer)) queueSave();
  }

  // Start on the first step with something missing when resuming a draft with content.
  renderSaveState();
  if (isDraft && s.title) {
    const firstIncomplete = [0, 1, 2].find((i) => Object.keys(stepErrors(i)).length);
    s.step = firstIncomplete ?? 3;
  }
  renderSteps();
  renderBody();
  renderSide();
  if (s.step === 0) main.querySelector('#f-title')?.focus({ preventScroll: true });
  return cleanup;
}

// A title hint. Types can set `titleExample` in the catalog; otherwise a generic pattern.
function placeholderTitle(type) {
  return type.titleExample || `${type.name} for <audience, event or campaign>`;
}
