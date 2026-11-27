// Settings: your profile (name, title, department, manager = default approver) and email notifications.

import { api } from '../lib/api.js';
import { store } from '../lib/store.js';
import { html, icon, setTitle, toast } from '../lib/ui.js';
import { DEPARTMENTS } from '../shared/catalog.js';
import { ROLE_LABELS } from '../shared/workflow.js';

export default async function settings(main) {
  setTitle('Settings');
  const me = store.me;

  main.innerHTML = String(
    html`<div class="page narrow">
      <div class="page-head">
        <div>
          <p class="eyebrow">Your account</p>
          <h1>Settings</h1>
          <p class="lede">
            You’re signed in as <strong>${me.email}</strong> · ${ROLE_LABELS[me.role]}${me.is_approver ? ' · Approver' : ''}.
          </p>
        </div>
      </div>
      <form class="stack" style="gap:20px" data-form novalidate>
        <section class="card pad" aria-labelledby="p-h">
          <h2 id="p-h" class="h3">Profile</h2>
          <p class="small muted" style="margin:4px 0 18px">Shown on your requests, so marketing knows who you are and where you sit.</p>
          <div class="settings-grid">
            <div class="field">
              <label class="label" for="s-name">Name</label
              ><input class="input" id="s-name" name="name" value="${me.name || ''}" maxlength="80" autocomplete="name" />
            </div>
            <div class="field">
              <label class="label" for="s-title">Job title</label
              ><input class="input" id="s-title" name="title" value="${me.title || ''}" maxlength="80" autocomplete="organization-title" />
            </div>
            <div class="field">
              <label class="label" for="s-dept">Department</label>
              <select class="select" id="s-dept" name="department">
                <option value="">Choose…</option>
                ${DEPARTMENTS.map((d) => html`<option ${d === me.department ? 'selected' : ''}>${d}</option>`)}
              </select>
            </div>
            <div class="field">
              <label class="label" for="s-mgr">Your manager</label>
              <input
                class="input"
                id="s-mgr"
                name="manager_email"
                type="email"
                data-people
                value="${me.manager_email || ''}"
                placeholder="Type their name"
                aria-describedby="s-mgr-h"
              />
              <span class="hint" id="s-mgr-h"
                >Type their name and pick them. They approve your requests by default. You can choose someone else on any request.</span
              >
            </div>
          </div>
        </section>
        <section class="card pad" aria-labelledby="n-h">
          <h2 id="n-h" class="h3">Notifications</h2>
          <p class="small muted" style="margin:4px 0 18px">
            The bell in the top bar always shows everything.
            ${store.emailEnabled ? '' : 'Email is not switched on for the portal yet, so for now you’ll see updates here only.'}
          </p>
          <label class="switch"
            ><input type="checkbox" role="switch" name="email_updates" ${me.email_updates ? 'checked' : ''} /><span></span>Email me updates
            on requests I’m part of</label
          >
          <p class="hint" style="margin-top:10px">Emails that need you to act (approve, answer a question, review work) are always sent.</p>
        </section>
        <div class="btn-row">
          <button class="btn primary" type="submit">${icon('check')}Save settings</button>
          <button class="btn ghost" type="button" data-replay>Show “How it works” again</button>
        </div>
      </form>
    </div>`,
  );

  const form = main.querySelector('[data-form]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const d = await api.patch('/api/me', {
        name: form.name.value,
        title: form.title.value,
        department: form.department.value,
        manager_email: form.manager_email.value || null,
        email_updates: form.email_updates.checked,
      });
      Object.assign(store.me, d.me);
      document.querySelector('[data-me-name]').textContent = d.me.name;
      toast('Settings saved.');
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      btn.disabled = false;
    }
  });
  main.querySelector('[data-replay]').addEventListener('click', async () => {
    await api.patch('/api/me', { tour_done: false });
    store.me.tour_done_at = null;
    toast('“How it works” is back on your home page.', { action: { href: '/', label: 'Go home' } });
  });
}
