// The app shell: router, navigation, notifications and the account menu.
// Each screen is a module in js/views/ exporting `default async function (main, ctx)`. It renders into `main` and may
// return a cleanup function. ctx = { params, query, path, navigate(url, {replace}), refreshCounts() }.

import { api } from './lib/api.js';
import { store, loadMe, isMarketing, isLead } from './lib/store.js';
import { html, icon, avatar, ago, toast, esc, setTitle, empty } from './lib/ui.js';
import { ROLE_LABELS } from './shared/workflow.js';

const ROUTES = [
  [/^\/$/, 'home'],
  [/^\/new$/, 'new'],
  [/^\/new\/(?<type>[\w-]+)$/, 'new'],
  [/^\/requests\/(?<ref>MR-\d+)\/edit$/i, 'new'],
  [/^\/requests\/(?<ref>MR-\d+)$/i, 'request'],
  [/^\/requests$/, 'list'],
  [/^\/approvals$/, 'list', { scope: 'approvals' }],
  [/^\/queue$/, 'queue'],
  [/^\/reports$/, 'reports'],
  [/^\/admin(?:\/(?<tab>people|types|audit))?$/, 'admin'],
  [/^\/settings$/, 'settings'],
  [/^\/help$/, 'help'],
];

const main = document.getElementById('main');
let cleanup = null;
let renderId = 0;

function match(path) {
  for (const [re, view, extra] of ROUTES) {
    const m = path.match(re);
    if (m) return { view, params: { ...(m.groups || {}), ...(extra || {}) } };
  }
  return null;
}

export function navigate(url, { replace = false } = {}) {
  const u = new URL(url, location.origin);
  if (u.origin !== location.origin) return void (location.href = url);
  if (u.pathname + u.search + u.hash === location.pathname + location.search + location.hash && !replace) return render();
  history[replace ? 'replaceState' : 'pushState']({}, '', u.pathname + u.search + u.hash);
  render();
}

async function render() {
  const id = ++renderId;
  closeNav();
  closePopovers();
  if (typeof cleanup === 'function')
    try {
      cleanup();
    } catch {}
  cleanup = null;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const route = match(path);
  updateNav(path);
  if (!route) {
    setTitle('Not found');
    main.innerHTML = String(
      html`<div class="page narrow">
        ${empty('We couldn’t find that page', 'It may have moved. Head home to see your requests.', { art: 'compass', action: html`<a class="btn primary" href="/" data-link>Go home</a>` })}
      </div>`,
    );
    return;
  }
  const query = Object.fromEntries(new URLSearchParams(location.search));
  try {
    const mod = await import(`./views/${route.view}.js`);
    if (id !== renderId) return;
    main.scrollTop = 0;
    window.scrollTo({ top: 0 });
    cleanup = await mod.default(main, { params: route.params, query, path, navigate, refreshCounts });
    if (id === renderId && !location.hash) main.focus({ preventScroll: true });
  } catch (e) {
    if (id !== renderId) return;
    console.error(e);
    main.innerHTML = String(
      html`<div class="page narrow">
        ${empty(e.status === 404 ? 'We couldn’t find that request' : 'Something went wrong', e.message || 'Try reloading the page.', { art: 'alert', action: html`<a class="btn" href="/" data-link>Go home</a>` })}
      </div>`,
    );
  }
}

// ------------------------------------------------------------------ navigation
function navItems() {
  const c = store.counts;
  const items = [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/requests', label: 'My requests', icon: 'inbox' },
  ];
  if (store.me.is_approver || c.approvals) items.push({ href: '/approvals', label: 'Approvals', icon: 'checkCircle', count: c.approvals });
  const team = [];
  if (isMarketing()) {
    team.push({ href: '/queue', label: 'Work queue', icon: 'board', count: c.unassigned });
    team.push({ href: '/reports', label: 'Reports', icon: 'chart' });
  }
  if (isLead()) team.push({ href: '/admin', label: 'People & routing', icon: 'users' });
  return { items, team };
}

function updateNav(path) {
  if (!store.me) return;
  const { items, team } = navItems();
  const link = (it) => {
    const current = it.href === '/' ? path === '/' : path === it.href || path.startsWith(it.href + '/');
    return html`<a href="${it.href}" data-link ${current ? html`aria-current="page"` : ''}
      >${icon(it.icon)}<span>${it.label}</span>${it.count ? html`<span class="count" aria-label="${it.count} waiting">${it.count}</span>` : ''}</a
    >`;
  };
  document.querySelector('[data-nav]').innerHTML = String(
    html`${items.map(link)}${
      team.length
        ? html`<p class="nav-label">Marketing</p>
            ${team.map(link)}`
        : ''
    }`,
  );
}

export async function refreshCounts() {
  try {
    const d = await api.get('/api/me');
    store.me = d.me;
    store.counts = d.counts;
    setBell(d.counts.unread);
    updateNav(location.pathname.replace(/\/+$/, '') || '/');
  } catch {}
}

function setBell(n) {
  const b = document.querySelector('[data-bell-count]');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
  document.querySelector('[data-bell]').setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
}

// Mobile drawer
const side = document.getElementById('side');
const scrim = document.querySelector('.scrim');
const menuBtn = document.querySelector('[data-open-nav]');
function openNav() {
  side.classList.add('open');
  scrim.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  side.querySelector('a, button')?.focus();
}
function closeNav() {
  if (!side.classList.contains('open')) return;
  side.classList.remove('open');
  scrim.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', openNav);
document.querySelectorAll('[data-close-nav]').forEach((el) => el.addEventListener('click', closeNav));

// ------------------------------------------------------------------ notifications popover
const inboxEl = document.querySelector('[data-inbox]');
const bellBtn = document.querySelector('[data-bell]');
const meMenu = document.querySelector('[data-me-menu]');
const meBtn = document.querySelector('[data-me-btn]');

function closePopovers() {
  inboxEl.hidden = true;
  meMenu.hidden = true;
  bellBtn.setAttribute('aria-expanded', 'false');
  meBtn.setAttribute('aria-expanded', 'false');
}

async function openInbox() {
  closePopovers();
  inboxEl.hidden = false;
  bellBtn.setAttribute('aria-expanded', 'true');
  inboxEl.innerHTML = String(
    html`<div class="inbox-head"><h2>Notifications</h2></div>
      <div class="page-loading" style="min-height:120px"><span class="spinner"></span></div>`,
  );
  try {
    const d = await api.get('/api/notifications');
    setBell(d.unread);
    inboxEl.innerHTML = String(
      html`<div class="inbox-head">
          <h2>Notifications</h2>
          ${d.unread ? html`<button type="button" class="link-btn small" data-read-all>Mark all read</button>` : ''}
        </div>
        <div class="inbox-list">
          ${
            d.items.length
              ? d.items.map(
                  (n) =>
                    html`<a
                      class="note ${n.read_at ? '' : 'unread'}"
                      href="${n.ref ? `/requests/${n.ref}` : '/'}"
                      data-link
                      data-note="${n.id}"
                    >
                      ${avatar(n.actor_email === 'system' ? 'system' : n.actor_email, n.actor_email === 'system' ? 'Reminder' : null, 'sm')}
                      <span
                        ><span class="txt">${n.text}</span>${n.ref ? html`<span class="tiny muted"> · ${n.ref}</span>` : ''}
                        <span class="when"
                          >${ago(n.created_at)}${n.action_needed && !n.read_at ? html` · <span class="act">Action needed</span>` : ''}</span
                        ></span
                      ></a
                    >`,
                )
              : empty('You’re all caught up', 'Updates on your requests will show up here.', { art: 'bell' })
          }
        </div>`,
    );
    inboxEl.querySelector('[data-read-all]')?.addEventListener('click', async () => {
      await api.post('/api/notifications/read', { all: true });
      refreshCounts();
      openInbox();
    });
    inboxEl.querySelector('.note, button')?.focus();
  } catch (e) {
    inboxEl.innerHTML = String(
      html`<div class="inbox-head"><h2>Notifications</h2></div>
        <p class="card-body muted">${e.message}</p>`,
    );
  }
}
bellBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  inboxEl.hidden ? openInbox() : closePopovers();
});
inboxEl.addEventListener('click', (e) => {
  const n = e.target.closest('[data-note]');
  if (n)
    api
      .post('/api/notifications/read', { id: Number(n.dataset.note) })
      .then(refreshCounts)
      .catch(() => {});
});

function renderMeMenu() {
  const me = store.me;
  meMenu.innerHTML = String(
    html`<div class="menu-head">
        <div class="row">
          ${avatar(me.email, me.name, 'lg')}
          <div style="min-width:0">
            <strong>${me.name}</strong>
            <div class="tiny muted">${me.email}</div>
            <div class="tiny muted">${ROLE_LABELS[me.role]}${me.is_approver ? ' · Approver' : ''}</div>
          </div>
        </div>
      </div>
      <a href="/settings" data-link role="menuitem">${icon('settings', 18)}Settings &amp; notifications</a>
      <a href="/help" data-link role="menuitem">${icon('help', 18)}Help &amp; how it works</a>
      <a href="/cdn-cgi/access/logout" role="menuitem">${icon('logout', 18)}Sign out</a>`,
  );
}
meBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!meMenu.hidden) return closePopovers();
  closePopovers();
  renderMeMenu();
  meMenu.hidden = false;
  meBtn.setAttribute('aria-expanded', 'true');
  meMenu.querySelector('a')?.focus();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-inbox], [data-me-menu]')) closePopovers();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!inboxEl.hidden || !meMenu.hidden) {
      const opener = !inboxEl.hidden ? bellBtn : meBtn;
      closePopovers();
      opener.focus();
    }
    closeNav();
  }
  // "/" focuses search (unless typing somewhere).
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
    e.preventDefault();
    document.getElementById('q').focus();
  }
});

// ------------------------------------------------------------------ search
document.querySelector('[data-search]').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (!q) return;
  if (/^mr-?\d+$/i.test(q)) return navigate(`/requests/MR-${q.replace(/\D/g, '')}`);
  navigate(`/requests?scope=${isMarketing() ? 'all' : 'involved'}&q=${encodeURIComponent(q)}`);
});

// ------------------------------------------------------------------ links
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (
    a.target ||
    a.hasAttribute('download') ||
    a.getAttribute('href').startsWith('/api/') ||
    a.getAttribute('href').startsWith('/cdn-cgi/')
  )
    return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin) return;
  if (u.pathname === location.pathname && u.hash && !u.search) return;
  e.preventDefault();
  navigate(u.pathname + u.search + u.hash);
});
window.addEventListener('popstate', render);

// ------------------------------------------------------------------ boot
async function boot() {
  try {
    await loadMe();
  } catch (e) {
    main.innerHTML = String(
      html`<div class="page narrow">
        ${empty('We couldn’t sign you in', e.message, { art: 'lock', action: html`<a class="btn primary" href="/cdn-cgi/access/logout">Sign in again</a>` })}
      </div>`,
    );
    return;
  }
  const me = store.me;
  document.querySelector('[data-me-avatar]').outerHTML = String(avatar(me.email, me.name));
  document.querySelector('[data-me-name]').textContent = me.name;
  setBell(store.counts.unread);
  await render();
  // Keep counts fresh while the tab is visible.
  setInterval(() => document.visibilityState === 'visible' && refreshCounts(), 60_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshCounts());
}
boot();

export { esc };
