// People & routing (marketing leads and admins):
//   People   roles (admins only; owners locked), approvers, managers, departments, active
//   Routing  per request type: on/off, who gets approved work, standard turnaround, whether approval is needed
//   Audit    who changed what

import { api } from '../lib/api.js';
import { store, isLead } from '../lib/store.js';
import { html, icon, avatar, dialog, toast, empty, spinner, debounce, setTitle, ago, nameOf, fmtDateTime } from '../lib/ui.js';
import { ROLES, ROLE_LABELS } from '../shared/workflow.js';
import { CATEGORIES, DEPARTMENTS, TYPE_BY_ID } from '../shared/catalog.js';

const TABS = [['people', 'People', 'users'], ['types', 'Routing', 'route'], ['audit', 'Audit log', 'clipboard']];
const ROLE_HINT = {
  requester: 'Requests work and reviews it',
  marketing: 'Sees all requests, produces and delivers work',
  lead: 'Also assigns work, approves for anyone, sets routing and sees team reports',
  admin: 'Also manages people and roles',
};

export default async function (main, ctx) {
  setTitle('People & routing');
  if (!isLead()) {
    main.innerHTML = String(html`<div class="page narrow">${empty('Admins only', 'Marketing leads and admins manage people and routing. Ask one if something needs changing.', { art: 'lock' })}</div>`);
    return;
  }
  const tab = ctx.params.tab || 'people';
  main.innerHTML = String(html`<div class="page wide admin">
    <div class="page-head"><div><p class="eyebrow">Marketing</p><h1>People &amp; routing</h1>
      <p class="lede">Who can do what, who approves, and where each kind of approved work goes.</p></div></div>
    <nav class="tabs" aria-label="Sections">${TABS.map(([id, l, i]) => html`<a class="tab" href="/admin${id === 'people' ? '' : '/' + id}" data-link ${id === tab ? html`aria-current="page"` : ''}>${icon(i, 18)}${l}</a>`)}</nav>
    <div data-out>${spinner()}</div></div>`);
  const out = main.querySelector('[data-out]');
  if (tab === 'types') return routing(out);
  return peopleTab(out, tab === 'audit');
}

// ------------------------------------------------------------------ people
async function peopleTab(out, auditOnly) {
  let d;
  try {
    d = await api.get('/api/admin/people');
  } catch (e) {
    out.innerHTML = String(empty('We couldn’t load people', e.message, { art: 'alert' }));
    return;
  }
  if (auditOnly) return auditTab(out, d.audit, d.people);
  let q = '';
  let roleFilter = '';
  const names = Object.fromEntries(d.people.map((p) => [p.email, p.name]));

  out.innerHTML = String(html`<div class="filters">
      <div class="filter-search"><label class="visually-hidden" for="pq">Search people</label>${icon('search', 18)}<input class="input" id="pq" type="search" placeholder="Search name, email or department" autocomplete="off" /></div>
      <label class="visually-hidden" for="prole">Role</label>
      <select class="select" id="prole"><option value="">All roles</option>${ROLES.map((r) => html`<option value="${r}">${ROLE_LABELS[r]}</option>`)}<option value="approver">Approvers</option></select>
      <button type="button" class="btn primary" data-add>${icon('plus', 18)}Add person</button>
    </div>
    <div class="role-key">${ROLES.map((r) => html`<span><strong>${ROLE_LABELS[r]}</strong> ${ROLE_HINT[r]}</span>`)}<span><strong>Approver</strong> Can be chosen to approve requests (usually managers)</span></div>
    ${!d.can_edit_roles ? html`<p class="small muted">Only admins can change roles. You can set approvers, managers and departments.</p>` : ''}
    <p class="result-count small muted" data-count></p>
    <div class="table-wrap card"><table class="table people-table">
      <thead><tr><th scope="col">Person</th><th scope="col">Department</th><th scope="col">Manager</th><th scope="col">Role</th><th scope="col">Approver</th><th scope="col">Active</th><th scope="col" class="num">Requests</th><th scope="col" class="num">Open work</th><th scope="col"><span class="visually-hidden">Edit</span></th></tr></thead>
      <tbody data-rows></tbody></table></div>`);

  const tbody = out.querySelector('[data-rows]');
  function rows() {
    const ql = q.toLowerCase();
    const list = d.people.filter((p) =>
      (!ql || [p.name, p.email, p.department, p.title].join(' ').toLowerCase().includes(ql)) &&
      (!roleFilter || (roleFilter === 'approver' ? p.is_approver : p.role === roleFilter)));
    out.querySelector('[data-count]').textContent = `${list.length} ${list.length === 1 ? 'person' : 'people'}`;
    tbody.innerHTML = String(list.length ? list.map((p) => {
      const me = p.email === store.me.email;
      const lockRole = !d.can_edit_roles || p.owner || me;
      return html`<tr data-email="${p.email}" class="${p.active === 0 ? 'inactive' : ''}">
        <th scope="row"><span class="person">${avatar(p.email, p.name, 'sm')}<span class="stack tight"><span class="nm">${p.name || nameOf(p.email)}${me ? ' (you)' : ''}${p.owner ? html` <span class="badge plain t-done">Owner</span>` : ''}</span><span class="tiny muted">${p.title ? `${p.title} · ` : ''}${p.email}</span></span></span></th>
        <td class="nowrap">${p.department || html`<span class="muted">—</span>`}</td>
        <td class="nowrap">${p.manager_email ? nameOf(p.manager_email, names) : html`<span class="muted">—</span>`}</td>
        <td>${lockRole ? html`<span class="role-pill r-${p.role}" title="${p.owner ? 'Owners are always admins' : me ? 'You can’t change your own role' : 'Only admins can change roles'}">${ROLE_LABELS[p.role]}</span>`
          : html`<label class="visually-hidden" for="role-${p.email}">Role for ${p.name}</label><select class="select sm" id="role-${p.email}" data-field="role">${ROLES.map((r) => html`<option value="${r}" ${p.role === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`)}</select>`}</td>
        <td><label class="switch"><input type="checkbox" role="switch" data-field="is_approver" ${p.is_approver ? 'checked' : ''} ${p.owner ? 'disabled' : ''} aria-label="${p.name} can approve requests" /><span></span></label></td>
        <td><label class="switch"><input type="checkbox" role="switch" data-field="active" ${p.active !== 0 ? 'checked' : ''} ${me || p.owner ? 'disabled' : ''} aria-label="${p.name} is active" /><span></span></label></td>
        <td class="num">${p.requests ?? 0}</td><td class="num">${p.open_assigned ?? 0}</td>
        <td><button type="button" class="icon-btn" data-edit aria-label="Edit ${p.name}">${icon('edit', 18)}</button></td></tr>`;
    }) : html`<tr><td colspan="9">${empty('No one matches', 'Try another search, or add the person.', { art: 'search' })}</td></tr>`);
  }
  rows();

  async function save(email, body, msg) {
    try {
      d = await api.put(`/api/admin/people/${encodeURIComponent(email)}`, body);
      Object.assign(names, Object.fromEntries(d.people.map((p) => [p.email, p.name])));
      rows();
      toast(msg);
      return true;
    } catch (e) {
      toast(e.message, { error: true });
      rows();
      return false;
    }
  }

  tbody.addEventListener('change', (e) => {
    const f = e.target.dataset.field;
    if (!f) return;
    const tr = e.target.closest('tr');
    const p = d.people.find((x) => x.email === tr.dataset.email);
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    const msg = f === 'role' ? `${p.name} is now ${ROLE_LABELS[v].toLowerCase()}.` : f === 'is_approver' ? `${p.name} ${v ? 'can now approve requests' : 'is no longer an approver'}.` : `${p.name} is ${v ? 'active' : 'deactivated'}.`;
    save(p.email, { [f]: v }, msg);
  });
  tbody.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-edit]')) return;
    const p = d.people.find((x) => x.email === e.target.closest('tr').dataset.email);
    const v = await personDialog(p, d);
    if (v) save(p.email, v, `${v.name || p.name} updated.`);
  });
  out.querySelector('#pq').addEventListener('input', debounce((e) => { q = e.target.value.trim(); rows(); }, 150));
  out.querySelector('#prole').addEventListener('change', (e) => { roleFilter = e.target.value; rows(); });
  out.querySelector('[data-add]').addEventListener('click', async () => {
    const v = await personDialog(null, d);
    if (!v) return;
    const email = v.email.trim().toLowerCase();
    delete v.email;
    if (!d.can_edit_roles) delete v.role;
    save(email, v, `${v.name || email} added.`);
  });
}

function personDialog(p, d) {
  const managers = d.people.filter((x) => x.is_approver && x.email !== p?.email);
  return dialog({
    title: p ? `Edit ${p.name}` : 'Add a person',
    text: p ? p.email : 'They can sign in with their Yondr email straight away. Adding them first lets you set their role and manager before they arrive.',
    confirm: p ? 'Save' : 'Add person',
    body: html`<div class="grid cols-2 dialog-grid">
      ${p ? '' : html`<div class="field span-2"><label class="label" for="pd-email">Email <span class="req">*</span></label><input class="input" id="pd-email" name="email" type="email" required pattern="[^@\\s]+@overyondr\\.com" placeholder="name@overyondr.com" autofocus /><span class="hint">An @overyondr.com address.</span></div>`}
      <div class="field"><label class="label" for="pd-name">Name</label><input class="input" id="pd-name" name="name" value="${p?.name || ''}" maxlength="80" /></div>
      <div class="field"><label class="label" for="pd-title">Job title</label><input class="input" id="pd-title" name="title" value="${p?.title || ''}" maxlength="80" /></div>
      <div class="field"><label class="label" for="pd-dept">Department</label><select class="select" id="pd-dept" name="department"><option value="">—</option>${DEPARTMENTS.map((x) => html`<option ${p?.department === x ? 'selected' : ''}>${x}</option>`)}</select></div>
      <div class="field"><label class="label" for="pd-mgr">Manager (default approver)</label><select class="select" id="pd-mgr" name="manager_email"><option value="">—</option>${managers.map((m) => html`<option value="${m.email}" ${p?.manager_email === m.email ? 'selected' : ''}>${m.name}</option>`)}</select></div>
      ${d.can_edit_roles && !p?.owner && p?.email !== store.me.email ? html`<div class="field"><label class="label" for="pd-role">Role</label><select class="select" id="pd-role" name="role">${ROLES.map((r) => html`<option value="${r}" ${(p?.role || 'requester') === r ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`)}</select></div>` : ''}
      <div class="field switch-field"><label class="switch"><input type="checkbox" role="switch" name="is_approver" ${p?.is_approver ? 'checked' : ''} ${p?.owner ? 'disabled' : ''} /><span></span>Can approve requests</label></div>
    </div>`,
  }).then((v) => {
    if (!v) return null;
    if (p?.owner) delete v.is_approver;
    if (!v.manager_email) v.manager_email = null;
    return v;
  });
}

function auditTab(out, audit, people) {
  const names = Object.fromEntries(people.map((p) => [p.email, p.name]));
  const typeName = (id) => TYPE_BY_ID[id]?.name || id;
  const describe = (a) => {
    let det = {};
    try { det = JSON.parse(a.detail || '{}'); } catch {}
    if (a.action === 'person_updated') {
      const parts = Object.entries(det).map(([k, v]) => k === 'role' ? `role → ${ROLE_LABELS[v] || v}` : k === 'is_approver' ? (v ? 'made an approver' : 'removed as approver') : k === 'active' ? (v ? 'reactivated' : 'deactivated') : k === 'manager_email' ? `manager → ${v ? nameOf(v, names) : 'none'}` : `${k.replace('_', ' ')} → ${v ?? '—'}`);
      return html`updated <strong>${nameOf(a.target, names)}</strong>: ${parts.join(', ')}`;
    }
    if (a.action === 'type_updated') {
      return html`changed routing for <strong>${typeName(a.target)}</strong>: ${det.enabled ? 'on' : 'off'}, ${det.default_assignee ? `goes to ${nameOf(det.default_assignee, names)}` : 'lead triages'}${det.lead_days !== null && det.lead_days !== undefined ? `, ${det.lead_days} days` : ''}${det.requires_approval === null || det.requires_approval === undefined ? '' : det.requires_approval ? ', approval required' : ', no approval'}`;
    }
    return html`${a.action} ${a.target || ''}`;
  };
  out.innerHTML = String(audit.length ? html`<ol class="card audit">${audit.map((a) => html`<li>${avatar(a.actor_email, names[a.actor_email], 'sm')}<div><p><strong>${nameOf(a.actor_email, names)}</strong> ${describe(a)}</p><p class="tiny muted" title="${fmtDateTime(a.created_at)}">${ago(a.created_at)}</p></div></li>`)}</ol>`
    : empty('No changes yet', 'Role, approver and routing changes are recorded here.', { art: 'clipboard' }));
}

// ------------------------------------------------------------------ routing
async function routing(out) {
  let d, team;
  try {
    [d, team] = await Promise.all([api.get('/api/admin/types'), api.get('/api/admin/people')]);
  } catch (e) {
    out.innerHTML = String(empty('We couldn’t load routing', e.message, { art: 'alert' }));
    return;
  }
  const makers = team.people.filter((p) => p.role !== 'requester' && p.active !== 0);
  const draw = () => {
    out.innerHTML = String(html`<p class="lede small muted routing-lede">When a request is approved it goes to the type’s default owner, who gets an alert to start. With no owner set, it waits in the queue and marketing leads are alerted to assign it.</p>
      ${CATEGORIES.map((c) => {
        const types = d.types.filter((t) => t.category === c.id);
        if (!types.length) return '';
        return html`<section class="card routing-group"><div class="card-head"><h2>${c.name}</h2><span class="small muted">${c.blurb}</span></div>
          <div class="table-wrap"><table class="table routing-table"><thead><tr><th scope="col">Request type</th><th scope="col">Available</th><th scope="col">Approved work goes to</th><th scope="col">Turnaround</th><th scope="col">Manager approval</th></tr></thead>
          <tbody>${types.map((t) => {
            const s = t.settings || {};
            const enabled = s.enabled === undefined || s.enabled === null ? true : !!s.enabled;
            const appr = s.requires_approval === null || s.requires_approval === undefined ? 'default' : s.requires_approval ? 'yes' : 'no';
            return html`<tr data-type="${t.id}" class="${enabled ? '' : 'inactive'}">
              <th scope="row"><span class="type-cell">${icon(TYPE_BY_ID[t.id]?.icon || 'doc', 18)}${t.name}</span></th>
              <td><label class="switch"><input type="checkbox" role="switch" data-f="enabled" ${enabled ? 'checked' : ''} aria-label="${t.name} available to request" /><span></span></label></td>
              <td><label class="visually-hidden" for="as-${t.id}">Default owner for ${t.name}</label><select class="select sm" id="as-${t.id}" data-f="default_assignee">
                <option value="">Lead triages</option>${makers.map((m) => html`<option value="${m.email}" ${s.default_assignee === m.email ? 'selected' : ''}>${m.name}</option>`)}</select></td>
              <td><span class="days-input"><label class="visually-hidden" for="ld-${t.id}">Standard turnaround for ${t.name}, business days</label>
                <input class="input sm" id="ld-${t.id}" type="number" min="0" max="120" inputmode="numeric" data-f="lead_days" value="${s.lead_days ?? ''}" placeholder="${t.leadDays}" /><span class="small muted">days</span></span></td>
              <td><label class="visually-hidden" for="ap-${t.id}">Approval for ${t.name}</label><select class="select sm" id="ap-${t.id}" data-f="requires_approval">
                <option value="default" ${appr === 'default' ? 'selected' : ''}>Default (${t.requiresApproval ? 'required' : 'not needed'})</option>
                <option value="yes" ${appr === 'yes' ? 'selected' : ''}>Always required</option><option value="no" ${appr === 'no' ? 'selected' : ''}>Not needed</option></select></td></tr>`;
          })}</tbody></table></div></section>`;
      })}`);
  };
  draw();
  out.addEventListener('change', async (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    const id = e.target.closest('tr').dataset.type;
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'default_assignee') v = v || null;
    if (f === 'lead_days') v = v === '' ? null : Number(v);
    if (f === 'requires_approval') v = v === 'default' ? null : v === 'yes';
    try {
      d = await api.put(`/api/admin/types/${id}`, { [f]: v });
      const t = d.types.find((x) => x.id === id);
      toast(f === 'enabled' ? `${t.name} is ${v ? 'available' : 'hidden from the request form'}.` : f === 'default_assignee' ? `${t.name}: approved work goes to ${v ? nameOf(v, Object.fromEntries(makers.map((m) => [m.email, m.name]))) : 'the queue for a lead to assign'}.` : `${t.name} updated.`);
      const row = out.querySelector(`tr[data-type="${id}"]`);
      if (f === 'enabled') row.classList.toggle('inactive', !v);
    } catch (err) {
      toast(err.message, { error: true });
      draw();
    }
  });
}
