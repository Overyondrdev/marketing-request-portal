// One request: where it is, whose move it is, the brief, the work, the conversation and the history.
// Every change re-renders from the payload the API returns (GET /api/requests/:ref shape).

import { api, upload, ApiError, MAX_UPLOAD } from '../lib/api.js';
import { store, loadPeople, isMarketing, isLead } from '../lib/store.js';
import {
  html,
  raw,
  icon,
  fmtDate,
  fmtDateTime,
  ago,
  dueLabel,
  plural,
  bytes,
  avatar,
  nameOf,
  person,
  statusBadge,
  priorityLabel,
  PRIORITY_LABEL,
  toast,
  dialog,
  confirmDialog,
  empty,
  spinner,
  setTitle,
  todayYmd,
} from '../lib/ui.js';
import { STAGES, stageOf, STATUSES, ACTIONS } from '../shared/workflow.js';
import { TYPE_BY_ID, CATEGORIES, BASE_FIELDS, visibleFields, formatAnswer } from '../shared/catalog.js';

const PAUSABLE = ['pending_approval', 'approved', 'in_progress', 'on_hold'];
const EDIT_STATUSES = ['draft', 'pending_approval', 'needs_info', 'rejected'];
const IMG = /^image\/(png|jpeg|gif|webp|avif)$/;
const AD_LIBRARY = 'https://ads.overyondrdev.com';
// Order of buttons in the action bar; the first available one is the primary action.
const ORDER = [
  'approve',
  'reject',
  'resubmit',
  'start',
  'deliver',
  'accept',
  'request_changes',
  'complete',
  'assign',
  'resume',
  'hold',
  'rate',
  'reopen',
  'cancel',
];
const PRIMARY = new Set(['approve', 'resubmit', 'start', 'deliver', 'accept', 'resume']);

export default async function view(main, ctx) {
  const ref = ctx.params.ref.toUpperCase();
  let d = null;
  let busy = false;
  let loadedAt = 0;
  // Composer state survives re-renders.
  const composer = { mode: 'comment', text: '', to: '', blocking: false };
  const replies = {}; // question id -> draft answer text

  main.innerHTML = String(spinner());
  setTitle(ref);

  const me = () => store.me;
  const first = (n) => String(n || '').split(' ')[0];
  const names = () => d.names || {};
  const nm = (email) => (email === 'system' ? 'Portal' : nameOf(email, names()));

  async function load() {
    d = await api.get(`/api/requests/${ref}`);
    loadedAt = Date.now();
  }

  try {
    await load();
  } catch (e) {
    main.innerHTML = String(
      html`<div class="page narrow">
        ${empty(e.status === 404 ? 'We couldn’t find that request' : 'Something went wrong', e.status === 404 ? 'It may have been deleted, or it isn’t shared with you. Ask the requester to add you as a follower.' : e.message, { art: 'compass', action: html`<a class="btn primary" href="/requests" data-link>See your requests</a>` })}
      </div>`,
    );
    return;
  }
  if (d.request.status === 'draft' && d.me.relation.requester) {
    ctx.navigate(`/requests/${ref}/edit`, { replace: true });
    return;
  }
  api
    .post('/api/notifications/read', { ref })
    .then(() => ctx.refreshCounts())
    .catch(() => {});
  loadPeople().catch(() => {});

  // ---------------------------------------------------------------- render
  function render() {
    const r = d.request;
    const type = TYPE_BY_ID[r.type_id];
    setTitle(`${r.ref} ${r.title || ''}`.trim());
    const focusId = document.activeElement?.id;
    main.innerHTML = String(
      html`<div class="page rq">
        ${header(r, type)} ${banner(r)} ${stepper(r)}
        <div class="rq-grid">
          <div class="rq-main">
            ${actionBar(r)} ${briefCard(r, type)} ${deliverablesCard(r, type)} ${referencesCard(r)} ${conversationCard(r)}
            ${activityCard(r)}
          </div>
          <aside class="rq-side" aria-label="Request details">${detailsCard(r)} ${watchersCard(r)} ${toolsCard(r)}</aside>
        </div>
      </div>`,
    );
    if (focusId) document.getElementById(focusId)?.focus();
  }

  // ---------------------------------------------------------------- header
  function header(r, type) {
    const cat = CATEGORIES.find((c) => c.id === r.category_id);
    const canTitle = d.me.can_edit || d.me.can_manage;
    const open = STATUSES[r.status]?.open;
    return html`<header class="rq-head">
      <a class="rq-back" href="/requests" data-link>${icon('arrowLeft', 16)}Requests</a>
      <p class="rq-eyebrow">
        <span class="ref">${r.ref}</span
        ><span class="rq-type">${icon(type?.icon || 'dot', 16)}${r.type_name}</span
        >${cat ? html`<span class="muted">${cat.name}</span>` : ''}
      </p>
      <div class="rq-title-row">
        <h1 class="rq-title" id="rq-title">${r.title || 'Untitled request'}</h1>
        ${canTitle ? html`<button type="button" class="icon-btn" data-act="edit-title" aria-label="Rename request" title="Rename">${icon('edit', 18)}</button>` : ''}
      </div>
      <div class="rq-badges">
        ${r.status === 'in_review' && !d.me.relation.requester ? html`<span class="badge t-review">With requester for review</span>` : statusBadge(r.status)}
        ${r.overdue ? html`<span class="badge overdue">Overdue</span>` : ''} ${r.is_rush ? html`<span class="badge rush">Rush</span>` : ''}
        ${priorityLabel(r.priority)} ${r.due_date ? dueLabel(r.due_date, open && r.status !== 'in_review') : ''}
        ${r.waiting_on ? html`<span class="waiting ${r.waiting_on === me().email ? 'you' : ''}">Waiting on <strong>${r.waiting_on === me().email ? 'you' : nm(r.waiting_on)}</strong></span>` : ''}
      </div>
    </header>`;
  }

  // ---------------------------------------------------------------- your move
  function openQuestionsFor(email) {
    return d.comments.filter((c) => c.kind === 'question' && !c.resolved_at && c.to_email === email);
  }

  let bannerActs = new Set();
  function banner(r) {
    bannerActs = new Set();
    const acts = d.me.actions;
    const rel = d.me.relation;
    const name = first(me().name);
    const btn = (a, label, cls = '') =>
      acts.includes(a) ? (bannerActs.add(a), html`<button type="button" class="btn ${cls}" data-act="${a}">${label}</button>`) : '';
    let tone = 'you',
      title = '',
      text = '',
      buttons = '';
    const myQs = openQuestionsFor(me().email);

    if (r.status === 'pending_approval' && acts.includes('approve')) {
      title = rel.approver ? `${name}, this needs your approval` : `Waiting on ${first(nm(r.approver_email))}’s approval`;
      text = rel.approver
        ? `${nm(r.requester_email)} asked marketing for ${aOrAn(r.type_name)}${r.due_date ? `, needed by ${fmtDate(r.due_date)}` : ''}. Approve it to send it to the marketing team.`
        : 'As a marketing lead you can approve or decline on their behalf.';
      buttons = html`${btn('approve', html`${icon('check', 18)}Approve`, 'lime')}${btn('reject', 'Decline', 'ghost-light')}<button
          type="button"
          class="btn ghost-light"
          data-act="ask"
        >
          ${icon('question', 18)}Ask a question
        </button>`;
    } else if (myQs.length) {
      title = r.status === 'needs_info' ? 'Marketing needs an answer from you' : `${first(nm(myQs[0].author_email))} asked you a question`;
      text =
        r.status === 'needs_info' ? 'Work is paused until you answer. It picks up again as soon as you reply.' : myQs[0].body.slice(0, 160);
      buttons = html`<button type="button" class="btn lime" data-act="goto-question" data-id="${myQs[0].id}">
        ${icon('message', 18)}Answer the question
      </button>`;
    } else if (r.status === 'in_review' && rel.requester) {
      title = 'The work is ready for your review';
      text = d.request.links.some((l) => l.url.startsWith(AD_LIBRARY))
        ? 'Review the ads in the ad library, then accept them here or ask for changes.'
        : 'Look over the deliverables below, then accept them or ask for changes.';
      buttons = html`${btn('accept', html`${icon('check', 18)}Accept and close`, 'lime')}${btn('request_changes', 'Request changes', 'ghost-light')}`;
    } else if (r.status === 'rejected' && rel.requester) {
      tone = 'warn';
      title = 'Not approved yet';
      const note = [...d.events].reverse().find((e) => e.action === 'reject');
      text = note?.detail?.note
        ? `${first(nm(note.actor_email))}: “${note.detail.note}”`
        : 'Revise the brief and resubmit, or cancel the request.';
      buttons = html`${d.me.can_edit ? html`<a class="btn lime" href="/requests/${r.ref}/edit" data-link>${icon('edit', 18)}Revise the brief</a>` : ''}${btn('resubmit', 'Resubmit as is', 'ghost-light')}`;
    } else if (r.status === 'approved' && !r.assignee_email && rel.marketing) {
      title = 'This approved request needs an owner';
      text = `${r.type_name}${r.due_date ? `, due ${fmtDate(r.due_date)}` : ''}. Take it, or assign it to someone on the team.`;
      if (!isLead()) bannerActs.add('assign');
      buttons = html`${acts.includes('assign') ? html`<button type="button" class="btn lime" data-act="take">${icon('user', 18)}Take it</button>` : ''}${isLead() ? btn('assign', 'Assign…', 'ghost-light') : ''}`;
    } else if (r.status === 'approved' && rel.assignee) {
      title = `${name}, this is yours to start`;
      text = 'Read the brief, ask anything that’s unclear, then start work so the requester knows it’s moving.';
      buttons = html`${btn('start', html`${icon('play', 18)}Start work`, 'lime')}<button
          type="button"
          class="btn ghost-light"
          data-act="ask"
        >
          ${icon('question', 18)}Ask a question
        </button>`;
    } else if (r.status === 'in_progress' && rel.assignee) {
      title = 'In production';
      text = `Upload the work to round ${r.revision_count + 1} below, then send it for review.`;
      buttons = html`${btn('deliver', html`${icon('arrowRight', 18)}Send for review`, 'lime')}`;
    } else if (r.status === 'completed' && rel.requester && !r.rating && acts.includes('rate')) {
      tone = 'calm';
      title = 'Delivered. How did it go?';
      text = 'A quick rating helps the marketing team keep improving.';
      buttons = btn('rate', html`${icon('star', 18)}Rate this request`, 'lime');
    } else {
      return '';
    }
    return html`<section class="rq-banner tone-${tone} rise" aria-label="Your next step">
      <div class="rq-banner-text">
        <p class="eyebrow">${tone === 'calm' ? 'All done' : 'Your move'}</p>
        <h2>${title}</h2>
        ${text ? html`<p>${text}</p>` : ''}
      </div>
      <div class="btn-row">${buttons}</div>
    </section>`;
  }

  // ---------------------------------------------------------------- stepper
  function stepper(r) {
    const ev = d.events;
    const last = (...acts) => [...ev].reverse().find((e) => acts.includes(e.action));
    const firstEv = (...acts) => ev.find((e) => acts.includes(e.action));
    let status = r.status;
    let current = stageOf(r);
    if (status === 'cancelled') {
      const c = last('cancel');
      current = stageOf({ status: c?.from_status || 'draft', prior_status: r.prior_status });
    }
    const idx = STAGES.findIndex((s) => s.id === current);
    const submit = last('submit', 'resubmit');
    const autoApproved = submit?.to_status === 'approved';
    const approvedAt = last('approve')?.created_at || (autoApproved ? submit.created_at : null);
    const dates = {
      brief: submit?.created_at || firstEv('created')?.created_at,
      approval: approvedAt || (status === 'rejected' ? last('reject')?.created_at : null),
      queue: last('assign')?.created_at || approvedAt,
      production: firstEv('start')?.created_at,
      review: last('deliver')?.created_at,
      done: last('accept', 'complete')?.created_at,
    };
    const special = {
      needs_info: { label: 'Waiting on an answer', tone: 'warn' },
      on_hold: { label: 'On hold', tone: 'muted' },
      rejected: { label: 'Not approved', tone: 'bad' },
      cancelled: { label: 'Cancelled', tone: 'bad' },
    }[status];
    const label = (s) =>
      s.id === 'approval' && autoApproved && !last('approve')
        ? 'Approval not needed'
        : s.id === 'review' && !d.me.relation.requester
          ? 'Requester review'
          : s.label;
    return html`<nav class="rq-steps" aria-label="Progress">
      <ol>
        ${STAGES.map((s, i) => {
          const state = status === 'completed' || i < idx ? 'done' : i === idx ? 'current' : 'todo';
          const when = state !== 'todo' ? dates[s.id] : null;
          return html`<li
            class="st-${state} ${state === 'current' && special ? `st-${special.tone}` : ''}"
            ${state === 'current' && status !== 'completed' ? html`aria-current="step"` : ''}
          >
            <span class="dotc" aria-hidden="true">${state === 'done' ? icon('check', 14) : i + 1}</span>
            <span class="st-text"
              ><span class="st-label">${label(s)}</span>
              ${state === 'current' && special ? html`<span class="st-note">${special.label}</span>` : when ? html`<span class="st-date">${fmtDate(when)}</span>` : ''}
            </span>
            ${state === 'done' ? html`<span class="visually-hidden">(done)</span>` : ''}
          </li>`;
        })}
      </ol>
    </nav>`;
  }

  // ---------------------------------------------------------------- actions
  function actionBar(r) {
    const acts = ORDER.filter((a) => d.me.actions.includes(a) && !bannerActs.has(a));
    if (!acts.length) return '';
    const primary = acts.find((a) => PRIMARY.has(a));
    return html`<div class="rq-actions card" role="group" aria-label="Actions">
      ${acts.map((a) => {
        let label = ACTIONS[a].label;
        if (a === 'assign') label = r.assignee_email ? 'Reassign' : 'Assign';
        if (a === 'approve' && !d.me.relation.approver) label = 'Approve on their behalf';
        const cls = a === primary ? 'primary' : a === 'cancel' ? 'danger' : '';
        return html`<button type="button" class="btn sm ${cls}" data-act="${a}">${label}</button>`;
      })}
    </div>`;
  }

  async function run(action, body = {}, okText = '') {
    if (busy) return;
    busy = true;
    main.querySelectorAll('[data-act]').forEach((b) => (b.disabled = true));
    try {
      d = await api.post(`/api/requests/${ref}/actions/${action}`, body);
      render();
      if (okText) toast(okText);
      ctx.refreshCounts();
    } catch (e) {
      handleError(e);
    } finally {
      busy = false;
      main.querySelectorAll('[data-act]').forEach((b) => (b.disabled = false));
    }
  }

  async function handleError(e) {
    toast(e.message, { error: true });
    if (e instanceof ApiError && (e.status === 409 || e.status === 404)) {
      try {
        await load();
        render();
      } catch {}
    }
  }

  const noteField = (label, { required = false, placeholder = '', hint = '' } = {}) =>
    html`<div class="field">
      <label class="label" for="dlg-note"
        >${label}${required ? html`<span class="req" aria-hidden="true">*</span>` : html`<span class="opt">Optional</span>`}</label
      >
      ${hint ? html`<p class="hint" id="dlg-note-hint">${hint}</p>` : ''}
      <textarea
        class="textarea"
        id="dlg-note"
        name="note"
        ${required ? 'required' : ''}
        maxlength="5000"
        placeholder="${placeholder}"
        ${hint ? html`aria-describedby="dlg-note-hint"` : ''}
      ></textarea>
    </div>`;

  const starsField = (legend, required = false) =>
    html`<fieldset class="stars-field">
      <legend class="label">${legend}${required ? '' : html`<span class="opt">Optional</span>`}</legend>
      <div class="stars" data-stars data-v="0">
        ${[1, 2, 3, 4, 5].map((n) => html`<label title="${n} of 5"><input type="radio" name="rating" value="${n}" ${required && n === 5 ? 'required' : ''} /><span class="visually-hidden">${n} star${n > 1 ? 's' : ''}</span>${icon('star', 30)}</label>`)}
      </div>
      <p class="hint" data-stars-label>Choose 1 to 5 stars.</p>
    </fieldset>`;
  const STAR_WORDS = ['', 'Not what we needed', 'Needed a lot of work', 'Good', 'Great', 'Outstanding'];
  function wireStars(dlg) {
    const box = dlg.querySelector('[data-stars]');
    if (!box) return;
    const lab = dlg.querySelector('[data-stars-label]');
    const set = (v) => {
      box.dataset.v = String(v);
      lab.textContent = v ? `${v} of 5 · ${STAR_WORDS[v]}` : 'Choose 1 to 5 stars.';
    };
    const checked = () => Number(box.querySelector('input:checked')?.value || 0);
    box.addEventListener('change', () => set(checked()));
    box.querySelectorAll('label').forEach((l, i) => {
      l.addEventListener('mouseenter', () => (box.dataset.v = String(i + 1)));
    });
    box.addEventListener('mouseleave', () => set(checked()));
  }

  async function team() {
    const people = await loadPeople();
    return people.filter((p) => p.role !== 'requester');
  }

  async function doAction(a) {
    const r = d.request;
    const who = (e) => first(nm(e));
    switch (a) {
      case 'approve': {
        const v = await dialog({
          title: 'Approve this request?',
          text: `It goes to the marketing team${d.settings?.defaultAssignee ? '' : ' queue'} straight away, and ${who(r.requester_email)} is told.`,
          body: noteField('Note for the requester and marketing', { placeholder: 'e.g. Approved. Keep it under budget.' }),
          confirm: 'Approve',
          tone: 'lime',
        });
        if (v) run('approve', { note: v.note }, 'Approved. It’s with the marketing team now.');
        return;
      }
      case 'reject': {
        const v = await dialog({
          title: 'Decline for now?',
          text: `${who(r.requester_email)} can revise the brief and resubmit. Say what would change your mind.`,
          body: noteField('Why', {
            required: true,
            placeholder: 'e.g. Let’s use the existing deck this quarter. Check with me before resubmitting.',
          }),
          confirm: 'Decline',
          tone: 'danger',
        });
        if (v) run('reject', { note: v.note }, 'Declined. The requester has been told why.');
        return;
      }
      case 'resubmit': {
        if (
          await confirmDialog(
            'Resubmit for approval?',
            `It goes back to ${who(r.approver_email) || 'your approver'} as it is. Revise the brief first if you were asked to change something.`,
            'Resubmit',
          )
        )
          run('resubmit', {}, 'Resubmitted for approval.');
        return;
      }
      case 'take':
        run('assign', { assignee: me().email }, 'It’s yours. Start when you’re ready.');
        return;
      case 'assign': {
        const people = isLead() ? await team() : [{ email: me().email, name: me().name }];
        const v = await dialog({
          title: r.assignee_email ? 'Reassign this request' : 'Who should create this?',
          text: 'They get the brief and an alert straight away.',
          body: html`<div class="field">
              <label class="label" for="dlg-assignee">Marketing team member</label>
              <select class="select" id="dlg-assignee" name="assignee" required>
                <option value="">Choose someone…</option>
                ${people.map((p) => html`<option value="${p.email}" ${p.email === r.assignee_email ? 'selected' : ''}>${p.name || p.email}${p.email === me().email ? ' (me)' : ''}${p.title ? ` · ${p.title}` : ''}</option>`)}
              </select>
            </div>
            ${people.some((p) => p.email === me().email) ? html`<p class="hint rq-mt"><button type="button" class="link-btn" data-assign-me>Assign to me</button></p>` : ''}`,
          confirm: 'Assign',
          onOpen: (dlg) =>
            dlg.querySelector('[data-assign-me]')?.addEventListener('click', () => {
              dlg.querySelector('#dlg-assignee').value = me().email;
              dlg.querySelector('[type=submit]').focus();
            }),
        });
        if (v)
          run(
            'assign',
            { assignee: v.assignee },
            v.assignee === me().email ? 'Assigned to you.' : `Assigned to ${who(v.assignee) || v.assignee}.`,
          );
        return;
      }
      case 'start':
        run('start', {}, 'Started. The requester can see it’s in production.');
        return;
      case 'deliver': {
        const round = r.revision_count + 1;
        const have = d.files.filter((f) => f.kind === 'deliverable' && f.version === round).length;
        const links = d.request.links.length;
        let input = null;
        const v = await dialog({
          title: `Send round ${round} for review`,
          text: `${who(r.requester_email)} gets an email asking them to accept the work or ask for changes.`,
          body: html`<p class="rq-deliver-sum ${have || links ? '' : 'warn'}">
              ${icon(have || links ? 'checkCircle' : 'alert', 18)}
              ${have || links ? html`${have ? plural(have, 'file') : ''}${have && links ? ' and ' : ''}${links ? plural(links, 'link') : ''} ready for this round.` : 'Nothing is attached to this round yet. Add files here or a link (like the ad library) first.'}
            </p>
            <div class="field">
              <label class="label" for="dlg-files">Add files</label><input class="input" type="file" id="dlg-files" multiple />
            </div>
            ${noteField('Note for the requester', { required: true, placeholder: 'What’s in this round, and what should they look at?' })}`,
          confirm: 'Send for review',
          tone: 'lime',
          onOpen: (dlg) => (input = dlg.querySelector('#dlg-files')),
        });
        if (!v) return;
        const files = [...(input?.files || [])];
        if (!have && !links && !files.length) return toast('Attach the work or add a link before sending it for review.', { error: true });
        if (files.length && !(await uploadFiles(files, 'deliverable'))) return;
        run('deliver', { note: v.note }, `Sent to ${who(r.requester_email)} for review.`);
        return;
      }
      case 'request_changes': {
        const v = await dialog({
          title: 'What should change?',
          text: `This starts round ${r.revision_count + 2}. Be specific, so the next round is the last.`,
          body: noteField('Changes', {
            required: true,
            placeholder: 'e.g. Swap slide 4’s photo for one from a high school; shorten the headline.',
          }),
          confirm: 'Request changes',
        });
        if (v) run('request_changes', { note: v.note }, 'Sent back to the marketing team with your changes.');
        return;
      }
      case 'accept': {
        const v = await dialog({
          title: 'Accept the work?',
          text: 'This closes the request. A rating helps the team improve.',
          body: html`${starsField('How did it go?')}
            <div class="field rq-mt">
              <label class="label" for="dlg-rc">Anything to add?<span class="opt">Optional</span></label
              ><textarea
                class="textarea"
                id="dlg-rc"
                name="rating_comment"
                maxlength="2000"
                placeholder="What went well, what could be better"
              ></textarea>
            </div>`,
          confirm: 'Accept and close',
          tone: 'lime',
          onOpen: wireStars,
        });
        if (v) run('accept', { rating: Number(v.rating) || undefined, rating_comment: v.rating_comment }, 'Accepted. Thanks!');
        return;
      }
      case 'rate': {
        const v = await dialog({
          title: 'Rate this request',
          body: html`${starsField('How did it go?', true)}
            <div class="field rq-mt">
              <label class="label" for="dlg-rc">Comment<span class="opt">Optional</span></label
              ><textarea class="textarea" id="dlg-rc" name="rating_comment" maxlength="2000"></textarea>
            </div>`,
          confirm: 'Save rating',
          onOpen: wireStars,
        });
        if (v) run('rate', { rating: Number(v.rating), rating_comment: v.rating_comment }, 'Thanks for the rating.');
        return;
      }
      case 'complete': {
        const v = await dialog({
          title: 'Mark as delivered?',
          text:
            r.status === 'in_review'
              ? `Closes the request without waiting for ${who(r.requester_email)} to accept. They can still reopen it.`
              : 'Closes the request. Use this when the work was delivered outside the portal.',
          body: noteField('Note'),
          confirm: 'Mark delivered',
        });
        if (v) run('complete', { note: v.note }, 'Marked delivered.');
        return;
      }
      case 'hold': {
        const v = await dialog({
          title: 'Put on hold?',
          text: 'The requester is told. Resume any time.',
          body: noteField('Why', { required: true }),
          confirm: 'Put on hold',
        });
        if (v) run('hold', { note: v.note }, 'On hold.');
        return;
      }
      case 'resume':
        run('resume', {}, 'Resumed.');
        return;
      case 'cancel': {
        const v = await dialog({
          title: 'Cancel this request?',
          text: 'Everyone involved is told. This can’t be undone, but you can duplicate it later.',
          body: noteField('Why', { required: true, placeholder: 'e.g. The event was postponed.' }),
          confirm: 'Cancel request',
          cancel: 'Keep it',
          tone: 'danger',
        });
        if (v) run('cancel', { note: v.note }, 'Cancelled.');
        return;
      }
      case 'reopen': {
        const v = await dialog({
          title: 'Reopen this request?',
          text: 'It goes back into production as a new round.',
          body: noteField('What’s needed', { required: true }),
          confirm: 'Reopen',
        });
        if (v) run('reopen', { note: v.note }, 'Reopened.');
        return;
      }
    }
  }

  // ---------------------------------------------------------------- brief
  function answerHtml(f, v) {
    if (f.type === 'url' && /^https?:\/\//i.test(String(v)))
      return html`<a href="${v}" target="_blank" rel="noopener noreferrer">${v}${icon('external', 14)}</a>`;
    if (f.type === 'links' && Array.isArray(v))
      return html`<ul class="rq-plain">
        ${v.map((u) => html`<li>${/^https?:\/\//i.test(u) ? html`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>` : u}</li>`)}
      </ul>`;
    if (f.type === 'date' && v) return html`${fmtDate(v, { weekday: true, year: true })}`;
    if (f.type === 'daterange' && v?.start) return html`${fmtDate(v.start, { year: true })} – ${fmtDate(v.end, { year: true })}`;
    if (f.type === 'multi' && Array.isArray(v))
      return html`<span class="rq-tags"
        >${formatAnswer(f, v)
          .split(', ')
          .map((t) => html`<span class="rq-tag">${t}</span>`)}</span
      >`;
    const text = formatAnswer(f, v);
    return html`<span class="rq-pre">${linkify(text)}</span>`;
  }

  function briefCard(r, type) {
    if (!type) return '';
    const brief = r.brief || {};
    const fields = visibleFields(type, brief).filter(
      (f) => brief[f.id] !== undefined && brief[f.id] !== '' && !(Array.isArray(brief[f.id]) && !brief[f.id].length),
    );
    const baseIds = new Set(BASE_FIELDS.map((f) => f.id));
    const section = (title, list) =>
      list.length
        ? html`<section class="rq-brief-sec">
            <h3>${title}</h3>
            <dl class="rq-answers">
              ${list.map(
                (f) =>
                  html`<div class="rq-ans ${f.type === 'textarea' ? 'wide' : ''}">
                    <dt>${f.label}</dt>
                    <dd>${answerHtml(f, brief[f.id])}</dd>
                  </div>`,
              )}
            </dl>
          </section>`
        : '';
    const canEdit = d.me.can_edit && EDIT_STATUSES.includes(r.status);
    return html`<section class="card rq-card" aria-labelledby="h-brief">
      <div class="card-head">
        <h2 id="h-brief">${icon('doc', 18)}The brief</h2>
        <div class="row">
          ${r.brief_score ? html`<span class="rq-score" title="How complete the brief was when submitted">Brief ${r.brief_score}% complete</span>` : ''}
          ${canEdit ? html`<a class="btn sm" href="/requests/${r.ref}/edit" data-link>${icon('edit', 16)}Edit brief</a>` : ''}
        </div>
      </div>
      <div class="card-body">
        ${
          r.is_rush && r.rush_reason
            ? html`<div class="rq-callout warn">
                ${icon('zap', 18)}
                <div>
                  <strong>Rush request.</strong> Due faster than the usual ${d.settings?.leadDays ?? type.leadDays} business days.
                  <span class="rq-pre">${r.rush_reason}</span>
                </div>
              </div>`
            : ''
        }
        ${section(
          'Goal and audience',
          fields.filter((f) => baseIds.has(f.id)),
        )}
        ${section(
          type.name,
          fields.filter((f) => !baseIds.has(f.id)),
        )}
        ${!fields.length ? html`<p class="muted">No answers yet.</p>` : ''}
        <p class="rq-deliv-note">
          ${icon('target', 16)}<span><strong>What you’ll get:</strong> ${type.deliverables}</span>
        </p>
      </div>
    </section>`;
  }

  // ---------------------------------------------------------------- files
  function fileItem(f) {
    const mine = f.uploaded_by === me().email;
    const canDel = (mine || isLead()) && STATUSES[d.request.status]?.open;
    const isImg = IMG.test(f.content_type || '');
    const isPdf = f.content_type === 'application/pdf';
    return html`<li class="rq-file">
      ${isImg ? html`<a class="rq-thumb" href="/api/files/${f.id}?inline=1" target="_blank" rel="noopener"><img src="/api/files/${f.id}?inline=1" alt="" loading="lazy" /></a>` : html`<span class="rq-thumb icon">${icon(isPdf ? 'doc' : 'file', 22)}</span>`}
      <span class="rq-file-meta"
        ><span class="rq-file-name">${f.name}</span
        ><span class="tiny muted">${bytes(f.size)} · ${nm(f.uploaded_by)} · ${ago(f.created_at)}</span></span
      >
      <span class="rq-file-acts">
        ${isImg || isPdf ? html`<a class="icon-btn" href="/api/files/${f.id}?inline=1" target="_blank" rel="noopener" aria-label="Open ${f.name}" title="Open">${icon('eye', 18)}</a>` : ''}
        <a class="icon-btn" href="/api/files/${f.id}" download aria-label="Download ${f.name}" title="Download">${icon('download', 18)}</a>
        ${canDel ? html`<button type="button" class="icon-btn" data-act="del-file" data-id="${f.id}" aria-label="Remove ${f.name}" title="Remove">${icon('trash', 18)}</button>` : ''}
      </span>
    </li>`;
  }

  const dropzone = (kind, label, hint) =>
    html`<div class="rq-drop" data-drop="${kind}">
      <input type="file" id="up-${kind}" multiple class="visually-hidden" data-file-input="${kind}" />
      <label for="up-${kind}"
        >${icon('upload', 22)}<span><strong>${label}</strong><span class="tiny muted">${hint}</span></span></label
      >
      <div class="rq-progress" data-progress="${kind}" hidden></div>
    </div>`;

  function deliverablesCard(r, type) {
    const files = d.files.filter((f) => f.kind === 'deliverable');
    const rounds = [...new Set(files.map((f) => f.version))].sort((a, b) => b - a);
    const links = r.links || [];
    const mk = d.me.can_manage;
    const canUpload = isMarketing() && ['approved', 'in_progress', 'in_review', 'on_hold', 'needs_info'].includes(r.status);
    const ad = type?.adLibrary;
    const nothing = !files.length && !links.length;
    const preWork = ['pending_approval', 'rejected', 'cancelled'].includes(r.status) || (r.status === 'needs_info' && !r.approved_at);
    if (nothing && !canUpload && !ad && preWork) return '';
    return html`<section class="card rq-card" aria-labelledby="h-deliv" id="deliverables">
      <div class="card-head">
        <h2 id="h-deliv">${icon('checkCircle', 18)}Deliverables</h2>
        ${r.revision_count ? html`<span class="tiny muted">${plural(r.revision_count, 'revision')}</span>` : ''}
      </div>
      <div class="card-body stack">
        ${
          ad
            ? html`<div class="rq-callout">
                ${icon('megaphone', 18)}
                <div>
                  <strong>Creative is reviewed in the ad library.</strong> The ads for this request are previewed, commented on and approved
                  at <a href="${AD_LIBRARY}" target="_blank" rel="noopener">ads.overyondrdev.com</a>; this page tracks the request.
                </div>
              </div>`
            : ''
        }
        ${
          links.length || mk
            ? html`<div class="rq-links">
                ${
                  links.length
                    ? html`<ul class="rq-link-list">
                        ${links.map(
                          (l, i) =>
                            html`<li>
                              <a href="${l.url}" target="_blank" rel="noopener noreferrer" class="rq-link"
                                >${icon(l.url.startsWith(AD_LIBRARY) ? 'megaphone' : 'link', 18)}<span
                                  ><strong>${l.label || hostOf(l.url)}</strong><span class="tiny muted">${hostOf(l.url)}</span></span
                                >${icon('external', 14)}</a
                              >${mk ? html`<button type="button" class="icon-btn" data-act="del-link" data-i="${i}" aria-label="Remove link ${l.label || l.url}">${icon('x', 16)}</button>` : ''}
                            </li>`,
                        )}
                      </ul>`
                    : ''
                }
                ${mk ? html`<button type="button" class="btn sm" data-act="add-link">${icon('link', 16)}Add a link</button>` : ''}
              </div>`
            : ''
        }
        ${rounds.map(
          (v, i) =>
            html`<div class="rq-round">
              <h3>Round ${v}${i === 0 ? html` <span class="badge plain t-go">Latest</span>` : ''}</h3>
              <ul class="rq-files">
                ${files.filter((f) => f.version === v).map(fileItem)}
              </ul>
            </div>`,
        )}
        ${nothing && !canUpload ? html`<p class="muted small">The finished work shows up here when marketing sends it for review.</p>` : ''}
        ${canUpload ? dropzone('deliverable', `Add files to round ${r.revision_count + 1}`, 'Drag and drop, or choose files. Up to 95 MB each; share a link for bigger files.') : ''}
      </div>
    </section>`;
  }

  function referencesCard(r) {
    const files = d.files.filter((f) => f.kind === 'reference');
    const rel = d.me.relation;
    const canUpload = STATUSES[r.status]?.open && (rel.requester || rel.marketing || rel.approver);
    if (!files.length && !canUpload) return '';
    return html`<section class="card rq-card" aria-labelledby="h-refs">
      <div class="card-head">
        <h2 id="h-refs">${icon('file', 18)}Reference files</h2>
        ${files.length ? html`<span class="tiny muted">${plural(files.length, 'file')}</span>` : ''}
      </div>
      <div class="card-body stack">
        ${
          files.length
            ? html`<ul class="rq-files">
                ${files.map(fileItem)}
              </ul>`
            : html`<p class="muted small">Examples, drafts, logos or data that help explain the request.</p>`
        }
        ${canUpload ? dropzone('reference', 'Add reference files', 'Drafts, examples, logos, data. Up to 95 MB each.') : ''}
      </div>
    </section>`;
  }

  async function uploadFiles(list, kind) {
    const bar = main.querySelector(`[data-progress="${kind}"]`);
    for (const file of list) {
      if (file.size > MAX_UPLOAD) {
        toast(`${file.name} is over 95 MB. Share a link instead.`, { error: true });
        continue;
      }
      if (!file.size) {
        toast(`${file.name} is empty.`, { error: true });
        continue;
      }
      if (bar) {
        bar.hidden = false;
        bar.innerHTML = String(html`<span class="small">Uploading ${file.name}…</span><span class="rq-bar"><span data-fill></span></span>`);
      }
      try {
        d = await upload(ref, file, {
          kind,
          onProgress: (p) => {
            const fill = bar?.querySelector('[data-fill]');
            if (fill) fill.style.width = `${Math.round(p * 100)}%`;
          },
        });
      } catch (e) {
        toast(e.message, { error: true });
        if (bar) bar.hidden = true;
        render();
        return false;
      }
    }
    render();
    toast(list.length > 1 ? `${list.length} files added.` : 'File added.');
    return true;
  }

  // ---------------------------------------------------------------- conversation
  function linkify(text) {
    const parts = String(text).split(/(https?:\/\/[^\s<>"')]+)/g);
    return parts.map((p, i) => (i % 2 ? html`<a href="${p}" target="_blank" rel="noopener noreferrer">${p}</a>` : p));
  }

  function canChange(c) {
    return c.author_email === me().email && c.kind !== 'system' && Date.now() - Date.parse(c.created_at) < 24 * 3600e3;
  }

  function messageHtml(c, replies = []) {
    const r = d.request;
    if (c.kind === 'system') {
      return html`<li class="msg sys" id="c-${c.id}">
        ${icon('info', 16)}<span
          ><strong>${nm(c.author_email)}</strong> · <span class="rq-pre">${linkify(c.body)}</span>
          <span class="tiny muted">${ago(c.created_at)}</span></span
        >
      </li>`;
    }
    const q = c.kind === 'question';
    const internal = c.kind === 'internal';
    const open = q && !c.resolved_at;
    const canAnswer = open && (c.to_email === me().email || c.author_email === me().email || isMarketing());
    const canResolve =
      open && (c.author_email === me().email || c.to_email === me().email || isMarketing()) && !(c.blocking && r.status === 'needs_info');
    return html`<li
      class="msg ${q ? 'q' : ''} ${open ? 'open' : ''} ${internal ? 'internal' : ''} ${c.author_email === me().email ? 'mine' : ''}"
      id="c-${c.id}"
    >
      ${avatar(c.author_email, nm(c.author_email), 'sm')}
      <div class="msg-main">
        <div class="msg-head">
          <strong>${nm(c.author_email)}</strong>
          ${q ? html`<span class="muted">asked ${c.to_email === me().email ? 'you' : first(nm(c.to_email))}</span>` : ''}
          ${internal ? html`<span class="msg-tag internal">${icon('lock', 13)}Internal note</span>` : ''}
          ${q ? (open ? html`<span class="msg-tag open">${icon('clock', 13)}Waiting for ${c.to_email === me().email ? 'your' : `${first(nm(c.to_email))}’s`} answer${c.blocking ? ' · work paused' : ''}</span>` : html`<span class="msg-tag done">${icon('check', 13)}Answered</span>`) : ''}
          <time class="tiny muted" datetime="${c.created_at}" title="${fmtDateTime(c.created_at)}"
            >${ago(c.created_at)}${c.edited_at ? ' · edited' : ''}</time
          >
        </div>
        <div class="msg-body rq-pre">${linkify(c.body)}</div>
        ${canChange(c) ? html`<div class="msg-tools"><button type="button" class="link-btn tiny" data-act="edit-msg" data-id="${c.id}">Edit</button><button type="button" class="link-btn tiny" data-act="del-msg" data-id="${c.id}">Delete</button></div>` : ''}
        ${
          replies.length
            ? html`<ul class="msg-replies">
                ${replies.map((x) => messageHtml(x))}
              </ul>`
            : ''
        }
        ${
          canAnswer
            ? html`<form class="msg-reply" data-reply="${c.id}">
                <label class="visually-hidden" for="reply-${c.id}">${c.to_email === me().email ? 'Your answer' : 'Reply'}</label>
                <textarea
                  class="textarea"
                  id="reply-${c.id}"
                  rows="2"
                  maxlength="10000"
                  placeholder="${c.to_email === me().email ? 'Write your answer…' : 'Reply…'}"
                  data-reply-text="${c.id}"
                >
${replies[c.id] || ''}</textarea>
                <div class="btn-row">
                  <button type="submit" class="btn sm primary">${c.to_email === me().email ? 'Send answer' : 'Reply'}</button>
                  ${canResolve ? html`<button type="button" class="btn sm ghost" data-act="resolve" data-id="${c.id}">Mark answered</button>` : ''}
                </div>
              </form>`
            : ''
        }
      </div>
    </li>`;
  }

  function conversationCard(r) {
    const all = d.comments;
    const top = all.filter((c) => !c.parent_id);
    const kids = (id) => all.filter((c) => c.parent_id === id);
    const mk = isMarketing();
    const rel = d.me.relation;
    const askable = [
      { email: r.requester_email, label: 'Requester' },
      { email: r.approver_email, label: 'Approver' },
      { email: r.assignee_email, label: 'Assignee' },
    ].filter((p) => p.email && p.email !== me().email);
    const seen = new Set();
    const askList = askable.filter((p) => (seen.has(p.email) ? false : seen.add(p.email)));
    const canPause = PAUSABLE.includes(r.status) && (mk || rel.approver);
    if (composer.mode === 'internal' && !mk) composer.mode = 'comment';
    if (composer.mode === 'question' && !askList.length) composer.mode = 'comment';
    if (composer.mode === 'question' && !askList.some((p) => p.email === composer.to)) composer.to = askList[0]?.email || '';
    const modeBtn = (m, label, ic) =>
      html`<button type="button" aria-pressed="${composer.mode === m}" data-act="mode" data-mode="${m}">${icon(ic, 15)}${label}</button>`;
    const placeholder = {
      comment: 'Write a comment for everyone on this request…',
      question: 'Ask a clear question. They get an email.',
      internal: 'Only the marketing team sees internal notes.',
    }[composer.mode];
    return html`<section class="card rq-card" aria-labelledby="h-conv" id="conversation">
      <div class="card-head">
        <h2 id="h-conv">${icon('message', 18)}Conversation</h2>
        <span class="tiny muted">${plural(top.filter((c) => c.kind !== 'system').length, 'message')}</span>
      </div>
      <div class="card-body">
        ${
          top.length
            ? html`<ul class="msgs">
                ${top.map((c) => messageHtml(c, kids(c.id)))}
              </ul>`
            : html`<p class="muted small rq-empty-conv">No messages yet. Questions and answers stay here, so everyone can see them.</p>`
        }
        <form class="composer ${composer.mode}" data-composer>
          <div class="seg" role="group" aria-label="Message type">
            ${modeBtn('comment', 'Comment', 'message')} ${askList.length ? modeBtn('question', 'Ask a question', 'question') : ''}
            ${mk ? modeBtn('internal', 'Internal note', 'lock') : ''}
          </div>
          ${
            composer.mode === 'question'
              ? html`<div class="composer-q">
                  <label class="small" for="q-to">Ask</label>
                  <select class="select sm" id="q-to" data-q-to>
                    ${askList.map((p) => html`<option value="${p.email}" ${p.email === composer.to ? 'selected' : ''}>${nm(p.email)} (${p.label})</option>`)}
                  </select>
                  ${canPause ? html`<label class="switch small"><input type="checkbox" role="switch" data-q-block ${composer.blocking ? 'checked' : ''} /><span></span>Pause work until answered</label>` : ''}
                </div>`
              : ''
          }
          ${composer.mode === 'internal' ? html`<p class="tiny composer-note">${icon('lock', 13)}Not visible to the requester or approver.</p>` : ''}
          <label class="visually-hidden" for="composer-text">Message</label>
          <textarea class="textarea" id="composer-text" rows="3" maxlength="10000" placeholder="${placeholder}" data-composer-text>
${composer.text}</textarea>
          <div class="spread composer-foot">
            <span class="tiny muted">${isMac() ? '⌘' : 'Ctrl'} + Enter to send</span>
            <button type="submit" class="btn sm primary">
              ${{ comment: 'Comment', question: 'Ask', internal: 'Add note' }[composer.mode]}
            </button>
          </div>
        </form>
      </div>
    </section>`;
  }

  async function sendComment() {
    const text = composer.text.trim();
    if (!text) return toast('Write something first.', { error: true });
    const body = { body: text, kind: composer.mode };
    if (composer.mode === 'question') Object.assign(body, { to_email: composer.to, blocking: composer.blocking });
    try {
      main.querySelector('[data-composer] [type=submit]').disabled = true;
      d = await api.post(`/api/requests/${ref}/comments`, body);
      const paused = composer.mode === 'question' && composer.blocking;
      composer.text = '';
      composer.blocking = false;
      render();
      toast(
        composer.mode === 'question'
          ? paused
            ? 'Question sent. Work is paused until they answer.'
            : 'Question sent.'
          : composer.mode === 'internal'
            ? 'Internal note added.'
            : 'Comment posted.',
      );
      composer.mode = 'comment';
      render();
      document.getElementById('composer-text')?.focus();
    } catch (e) {
      handleError(e);
      const b = main.querySelector('[data-composer] [type=submit]');
      if (b) b.disabled = false;
    }
  }

  async function sendReply(id) {
    const text = (replies[id] || '').trim();
    if (!text) return toast('Write your answer first.', { error: true });
    const was = d.request.status;
    try {
      d = await api.post(`/api/requests/${ref}/comments`, { body: text, parent_id: id });
      delete replies[id];
      render();
      toast(was === 'needs_info' && d.request.status !== 'needs_info' ? 'Answered. Work has picked up again.' : 'Reply posted.');
      ctx.refreshCounts();
    } catch (e) {
      handleError(e);
    }
  }

  // ---------------------------------------------------------------- activity
  function describe(e) {
    const t = e.detail || {};
    const who = (x) => (x === me().email ? 'you' : nm(x));
    switch (e.action) {
      case 'created':
        return 'started a draft';
      case 'duplicated':
        return `started a draft from ${t.from || 'another request'}`;
      case 'submit':
        return e.to_status === 'approved' ? 'submitted the request (no approval needed)' : 'submitted the request for approval';
      case 'resubmit':
        return 'resubmitted the request for approval';
      case 'approve':
        return t.on_behalf_of ? `approved the request on behalf of ${who(t.on_behalf_of)}` : 'approved the request';
      case 'reject':
        return 'declined the request';
      case 'assign':
        if (t.auto) return `routed it automatically to ${who(t.assignee)}`;
        return t.assignee === e.actor_email
          ? 'took the request'
          : `assigned it to ${who(t.assignee)}${t.previous ? ` (was ${who(t.previous)})` : ''}`;
      case 'start':
        return 'started work';
      case 'deliver':
        return `sent round ${t.round || 1} for review`;
      case 'request_changes':
        return `asked for changes (round ${(t.round || 0) + 1})`;
      case 'accept':
        return `accepted the work and closed the request${t.rating ? ` · rated ${t.rating}/5` : ''}`;
      case 'complete':
        return 'marked the request delivered';
      case 'hold':
        return 'put the request on hold';
      case 'resume':
        return 'resumed work';
      case 'resumed':
        return t.reason === 'answered' ? 'answered, so work picked up again' : 'resumed work';
      case 'cancel':
        return 'cancelled the request';
      case 'reopen':
        return 'reopened the request';
      case 'asked':
        return `asked ${who(t.to)} a question and paused work`;
      case 'answered':
        return 'answered a question';
      case 'rate':
        return `rated the work ${t.rating}/5`;
      case 'file_added':
        return `added ${t.kind === 'deliverable' ? `a deliverable to round ${t.version}` : 'a reference file'}: ${t.name}`;
      case 'file_removed':
        return `removed ${t.name}`;
      case 'edited': {
        const bits = [];
        if (t.due_date) bits.push(`changed the due date to ${t.due_date.to ? fmtDate(t.due_date.to) : 'none'}`);
        if (t.priority) bits.push(`set priority to ${PRIORITY_LABEL[t.priority.to] || t.priority.to}`);
        const rest = (t.fields || []).filter((f) => !['due_date', 'priority'].includes(f));
        const words = {
          title: 'the title',
          brief: 'the brief',
          links: 'the links',
          approver_email: 'the approver',
          rush_reason: 'the rush reason',
          department: 'the department',
        };
        if (rest.length) bits.push(`updated ${rest.map((f) => words[f] || f).join(', ')}`);
        return bits.join(', ') || 'edited the request';
      }
      default:
        return e.action.replace(/_/g, ' ');
    }
  }

  function activityCard() {
    const ev = [...d.events].reverse();
    return html`<section class="card rq-card" aria-labelledby="h-act">
      <details class="rq-activity" ${ev.length <= 6 ? 'open' : ''}>
        <summary class="card-head">
          <h2 id="h-act">${icon('clock', 18)}Activity</h2>
          <span class="tiny muted">${plural(ev.length, 'event')}</span>
        </summary>
        <ol class="timeline card-body">
          ${ev.map(
            (e) =>
              html`<li>
                <span class="tl-dot" aria-hidden="true"></span>
                <div>
                  <span><strong>${e.actor_email === me().email ? 'You' : nm(e.actor_email)}</strong> ${describe(e)}</span>
                  ${e.detail?.note ? html`<q class="tl-note">${e.detail.note}</q>` : ''}
                  <time class="tiny muted" datetime="${e.created_at}">${fmtDateTime(e.created_at)}</time>
                </div>
              </li>`,
          )}
        </ol>
      </details>
    </section>`;
  }

  // ---------------------------------------------------------------- side
  function detailsCard(r) {
    const mk = d.me.can_manage && STATUSES[r.status]?.open;
    const canAssign = d.me.actions.includes('assign');
    const stars = (n) =>
      html`<span class="rq-stars" role="img" aria-label="${n} out of 5"
        >${[1, 2, 3, 4, 5].map((i) => html`<span class="${i <= n ? 'on' : ''}">${icon('star', 16)}</span>`)}</span
      >`;
    const lastDeliver = [...d.events].reverse().find((e) => e.action === 'deliver');
    return html`<section class="card rq-card" aria-labelledby="h-details">
      <div class="card-head"><h2 id="h-details">Details</h2></div>
      <dl class="card-body rq-dl">
        <div>
          <dt>Requester</dt>
          <dd>
            ${person(r.requester_email, names(), { you: me().email })}${r.department ? html`<span class="tiny muted rq-sub">${r.department}</span>` : ''}
          </dd>
        </div>
        <div>
          <dt>Approver</dt>
          <dd>
            ${r.approver_email ? person(r.approver_email, names(), { you: me().email }) : html`<span class="muted">${r.approved_at ? 'Not needed' : 'None'}</span>`}
          </dd>
        </div>
        <div>
          <dt>Assigned to</dt>
          <dd class="rq-assignee">
            ${person(r.assignee_email, names(), { you: me().email })}
            ${canAssign ? html`<button type="button" class="link-btn small" data-act="${!r.assignee_email && !isLead() ? 'take' : 'assign'}">${!r.assignee_email ? (isLead() ? 'Assign' : 'Take it') : 'Change'}</button>` : ''}
          </dd>
        </div>
        <div>
          <dt><label for="rq-due">Due</label></dt>
          <dd>
            ${mk ? html`<input class="input sm" type="date" id="rq-due" value="${r.due_date || ''}" data-due />` : r.due_date ? html`${fmtDate(r.due_date, { weekday: true, year: true })}` : html`<span class="muted">Not set</span>`}
          </dd>
        </div>
        <div>
          <dt><label for="rq-prio">Priority</label></dt>
          <dd>
            ${
              mk
                ? html`<select class="select sm" id="rq-prio" data-prio>
                    ${Object.entries(PRIORITY_LABEL).map(([v, l]) => html`<option value="${v}" ${v === r.priority ? 'selected' : ''}>${l}</option>`)}
                  </select>`
                : PRIORITY_LABEL[r.priority]
            }
          </dd>
        </div>
        ${
          r.submitted_at
            ? html`<div>
                <dt>Submitted</dt>
                <dd>${fmtDate(r.submitted_at)}</dd>
              </div>`
            : ''
        }
        ${
          r.approved_at
            ? html`<div>
                <dt>Approved</dt>
                <dd>${fmtDate(r.approved_at)}</dd>
              </div>`
            : ''
        }
        ${
          lastDeliver
            ? html`<div>
                <dt>Last delivered</dt>
                <dd>${fmtDate(lastDeliver.created_at)}</dd>
              </div>`
            : ''
        }
        ${
          r.completed_at
            ? html`<div>
                <dt>Closed</dt>
                <dd>${fmtDate(r.completed_at)}</dd>
              </div>`
            : ''
        }
        ${
          r.brief_score
            ? html`<div>
                <dt>Brief</dt>
                <dd>
                  <span class="rq-meter" aria-hidden="true"><span class="w-${Math.round(r.brief_score / 10) * 10}"></span></span
                  ><span class="small">${r.brief_score}% complete</span>
                </dd>
              </div>`
            : ''
        }
        ${
          r.revision_count
            ? html`<div>
                <dt>Revisions</dt>
                <dd>${r.revision_count}</dd>
              </div>`
            : ''
        }
        ${
          r.rating
            ? html`<div>
                <dt>Rating</dt>
                <dd>${stars(r.rating)}${r.rating_comment ? html`<q class="tiny muted rq-sub">${r.rating_comment}</q>` : ''}</dd>
              </div>`
            : ''
        }
      </dl>
    </section>`;
  }

  function watchersCard(r) {
    const w = d.watchers;
    const rel = d.me.relation;
    const manage = rel.requester || isMarketing();
    const implied = rel.requester || rel.approver || rel.assignee;
    return html`<section class="card rq-card" aria-labelledby="h-watch">
      <div class="card-head">
        <h2 id="h-watch">Following</h2>
        ${!implied ? html`<button type="button" class="btn sm ${d.me.watching ? '' : 'primary'}" data-act="${d.me.watching ? 'unwatch' : 'watch'}">${d.me.watching ? 'Unfollow' : 'Follow'}</button>` : ''}
      </div>
      <div class="card-body stack">
        <p class="tiny muted">The requester, approver and creator get every update. Add others who should too.</p>
        ${
          w.length
            ? html`<ul class="rq-watchers">
                ${w.map((x) => html`<li>${person(x.email, names(), { you: me().email })}${manage || x.email === me().email ? html`<button type="button" class="icon-btn" data-act="rm-watcher" data-email="${x.email}" aria-label="Remove ${nm(x.email)}">${icon('x', 16)}</button>` : ''}</li>`)}
              </ul>`
            : ''
        }
        ${
          manage
            ? html`<form class="rq-add-watcher" data-add-watcher>
                <label class="visually-hidden" for="add-watcher">Add a person by name or email</label>
                <input class="input sm" id="add-watcher" list="people-list" placeholder="Add someone (name or email)" autocomplete="off" />
                <datalist id="people-list">
                  ${(store.people || []).filter((p) => !w.some((x) => x.email === p.email)).map((p) => html`<option value="${p.email}">${p.name}</option>`)}
                </datalist>
                <button type="submit" class="btn sm">Add</button>
              </form>`
            : ''
        }
      </div>
    </section>`;
  }

  function toolsCard(r) {
    return html`<section class="card rq-card no-print rq-tools">
      <a class="btn sm ghost" href="/new?duplicate=${r.ref}" data-link>${icon('copy', 16)}Duplicate request</a>
      <button type="button" class="btn sm ghost" data-act="copy-link">${icon('link', 16)}Copy link</button>
      <button type="button" class="btn sm ghost" data-act="print">${icon('doc', 16)}Print</button>
    </section>`;
  }

  // ---------------------------------------------------------------- events
  async function patch(body, okText) {
    try {
      d = await api.patch(`/api/requests/${ref}`, body);
      render();
      if (okText) toast(okText);
    } catch (e) {
      handleError(e);
      render();
    }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !main.contains(b) || b.disabled) return;
    const a = b.dataset.act;
    if (ACTIONS[a] || a === 'take') return doAction(a);
    switch (a) {
      case 'ask':
        composer.mode = 'question';
        composer.to = d.request.requester_email !== me().email ? d.request.requester_email : '';
        render();
        document.getElementById('conversation')?.scrollIntoView({ behavior: smooth(), block: 'start' });
        document.getElementById('composer-text')?.focus({ preventScroll: true });
        return;
      case 'goto-question': {
        const el = document.getElementById(`c-${b.dataset.id}`);
        el?.scrollIntoView({ behavior: smooth(), block: 'center' });
        document.getElementById(`reply-${b.dataset.id}`)?.focus({ preventScroll: true });
        return;
      }
      case 'mode':
        composer.mode = b.dataset.mode;
        render();
        document.getElementById('composer-text')?.focus();
        return;
      case 'resolve':
        try {
          d = await api.post(`/api/comments/${b.dataset.id}`, { resolve: true });
          render();
          toast('Marked answered.');
        } catch (err) {
          handleError(err);
        }
        return;
      case 'edit-msg': {
        const c = d.comments.find((x) => x.id === Number(b.dataset.id));
        const v = await dialog({
          title: 'Edit message',
          body: html`<label class="visually-hidden" for="dlg-edit">Message</label
            ><textarea class="textarea" id="dlg-edit" name="body" required maxlength="10000">${c?.body || ''}</textarea>`,
          confirm: 'Save',
        });
        if (!v) return;
        try {
          d = await api.patch(`/api/comments/${b.dataset.id}`, { body: v.body });
          render();
        } catch (err) {
          handleError(err);
        }
        return;
      }
      case 'del-msg':
        if (!(await confirmDialog('Delete this message?', 'It’s removed for everyone.', 'Delete', 'danger'))) return;
        try {
          d = await api.del(`/api/comments/${b.dataset.id}`);
          render();
        } catch (err) {
          handleError(err);
        }
        return;
      case 'del-file': {
        const f = d.files.find((x) => x.id === b.dataset.id);
        if (!(await confirmDialog(`Remove ${f?.name || 'this file'}?`, 'It’s deleted for everyone.', 'Remove', 'danger'))) return;
        try {
          d = await api.del(`/api/files/${b.dataset.id}`);
          render();
          toast('File removed.');
        } catch (err) {
          handleError(err);
        }
        return;
      }
      case 'add-link': {
        const ad = TYPE_BY_ID[d.request.type_id]?.adLibrary;
        const v = await dialog({
          title: 'Add a link',
          text: ad
            ? 'Link to the ads in the ad library, or to a shared folder or file.'
            : 'A shared folder, a live page, a Figma or Google file…',
          body: html`<div class="field">
              <label class="label" for="dlg-url">Link</label
              ><input
                class="input"
                type="url"
                id="dlg-url"
                name="url"
                required
                placeholder="https://"
                value="${ad && !d.request.links.some((l) => l.url.startsWith(AD_LIBRARY)) ? AD_LIBRARY + '/' : ''}"
              />
            </div>
            <div class="field">
              <label class="label" for="dlg-label">Label<span class="opt">Optional</span></label
              ><input
                class="input"
                id="dlg-label"
                name="label"
                maxlength="80"
                placeholder="${ad ? 'Ads in the ad library' : 'e.g. Final files in Drive'}"
              />
            </div>`,
          confirm: 'Add link',
        });
        if (!v) return;
        if (!/^https?:\/\//i.test(v.url.trim())) return toast('Links need to start with https://', { error: true });
        patch(
          {
            links: [
              ...d.request.links,
              { label: v.label || (v.url.startsWith(AD_LIBRARY) ? 'Ads in the ad library' : ''), url: v.url.trim() },
            ],
          },
          'Link added.',
        );
        return;
      }
      case 'del-link':
        patch({ links: d.request.links.filter((_, i) => i !== Number(b.dataset.i)) }, 'Link removed.');
        return;
      case 'edit-title': {
        const v = await dialog({
          title: 'Rename request',
          body: html`<label class="visually-hidden" for="dlg-title">Title</label
            ><input class="input" id="dlg-title" name="title" required minlength="3" maxlength="160" value="${d.request.title}" />`,
          confirm: 'Save',
        });
        if (v && v.title.trim() !== d.request.title) {
          await patch({ title: v.title.trim() }, 'Renamed.');
          document.querySelector('[data-act="edit-title"]')?.focus();
        }
        return;
      }
      case 'watch':
      case 'unwatch':
        try {
          d = a === 'watch' ? await api.post(`/api/requests/${ref}/watchers`, {}) : await api.del(`/api/requests/${ref}/watchers`);
          render();
          toast(a === 'watch' ? 'You’ll get updates on this request.' : 'You won’t get updates anymore.');
        } catch (err) {
          handleError(err);
        }
        return;
      case 'rm-watcher':
        try {
          d = await api.del(`/api/requests/${ref}/watchers?email=${encodeURIComponent(b.dataset.email)}`);
          render();
        } catch (err) {
          handleError(err);
        }
        return;
      case 'copy-link':
        try {
          await navigator.clipboard.writeText(location.origin + `/requests/${ref}`);
          toast('Link copied.');
        } catch {
          toast('Couldn’t copy. Copy the address bar instead.', { error: true });
        }
        return;
      case 'print':
        window.print();
        return;
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-composer-text]')) composer.text = t.value;
    else if (t.matches('[data-reply-text]')) replies[t.dataset.replyText] = t.value;
  }

  function onChange(e) {
    const t = e.target;
    if (t.matches('[data-q-to]')) composer.to = t.value;
    else if (t.matches('[data-q-block]')) composer.blocking = t.checked;
    else if (t.matches('[data-due]')) {
      const v = t.value || null;
      if (v && v < todayYmd() && !confirm('That date is in the past. Set it anyway?')) return render();
      patch({ due_date: v }, v ? `Due date set to ${fmtDate(v)}.` : 'Due date cleared.');
    } else if (t.matches('[data-prio]')) patch({ priority: t.value }, `Priority set to ${PRIORITY_LABEL[t.value]}.`);
    else if (t.matches('[data-file-input]')) {
      const files = [...t.files];
      t.value = '';
      if (files.length) uploadFiles(files, t.dataset.fileInput);
    }
  }

  async function onSubmit(e) {
    const f = e.target;
    if (f.matches('[data-composer]')) {
      e.preventDefault();
      sendComment();
    } else if (f.matches('[data-reply]')) {
      e.preventDefault();
      sendReply(Number(f.dataset.reply));
    } else if (f.matches('[data-add-watcher]')) {
      e.preventDefault();
      const input = f.querySelector('input');
      let v = input.value.trim().toLowerCase();
      if (!v) return;
      if (!v.includes('@')) {
        const p = (store.people || []).find((x) => x.name.toLowerCase() === v || x.email.startsWith(v + '@'));
        if (p) v = p.email;
        else if (/^[a-z0-9._-]+$/.test(v)) v = `${v}@overyondr.com`;
      }
      try {
        d = await api.post(`/api/requests/${ref}/watchers`, { email: v });
        render();
        toast(`${nm(v)} will get updates.`);
        document.getElementById('add-watcher')?.focus();
      } catch (err) {
        handleError(err);
      }
    }
  }

  function onKeydown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.matches('textarea[data-composer-text], textarea[data-reply-text]')) {
      e.preventDefault();
      e.target.form?.requestSubmit();
    }
  }

  // Drag and drop onto the upload zones.
  function onDrag(e) {
    const zone = e.target.closest?.('[data-drop]');
    if (!zone) return;
    e.preventDefault();
    if (e.type === 'dragover' || e.type === 'dragenter') zone.classList.add('over');
    else if (e.type === 'dragleave') zone.classList.remove('over');
    else if (e.type === 'drop') {
      zone.classList.remove('over');
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) uploadFiles(files, zone.dataset.drop);
    }
  }

  async function onVisible() {
    if (document.visibilityState !== 'visible' || busy || Date.now() - loadedAt < 15000) return;
    const active = document.activeElement;
    if (active && main.contains(active) && /^(TEXTAREA|INPUT|SELECT)$/.test(active.tagName)) return;
    if (document.querySelector('dialog[open]')) return;
    try {
      await load();
      render();
    } catch {}
  }

  render();
  main.addEventListener('click', onClick);
  main.addEventListener('input', onInput);
  main.addEventListener('change', onChange);
  main.addEventListener('submit', onSubmit);
  main.addEventListener('keydown', onKeydown);
  for (const t of ['dragenter', 'dragover', 'dragleave', 'drop']) main.addEventListener(t, onDrag);
  document.addEventListener('visibilitychange', onVisible);
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'start' });

  return () => {
    main.removeEventListener('click', onClick);
    main.removeEventListener('input', onInput);
    main.removeEventListener('change', onChange);
    main.removeEventListener('submit', onSubmit);
    main.removeEventListener('keydown', onKeydown);
    for (const t of ['dragenter', 'dragover', 'dragleave', 'drop']) main.removeEventListener(t, onDrag);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function aOrAn(name) {
  const n = String(name || 'request').toLowerCase();
  return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
}
function hostOf(u) {
  try {
    return new URL(u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
}
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
