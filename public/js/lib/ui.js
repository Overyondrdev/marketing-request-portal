// UI helpers shared by every screen. No framework: views render HTML strings with the `html` tag (which escapes
// every interpolated value) and wire events by delegation.
//
//   el.innerHTML = html`<p>${userText}</p>${raw(trustedMarkup)}`;   // userText is escaped, raw() is not
//   Arrays of html`` results can be interpolated directly.
//
// Never build markup by string concatenation with user data, and never put style="" in markup (use classes).

import { STATUSES } from '../shared/workflow.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Safe(String(s ?? ''));
const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v === false || v == null ? '' : esc(v));
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Safe(out);
}

// ------------------------------------------------------------------ icons (24×24, stroked)
const P = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4"/><path d="M12 17.4h.01"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  question:
    '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/><path d="M10 10a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.7M12 16h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 8.5a5 5 0 0 1 0 7M7 14l1.5 6h2.5l-1-5.4"/>',
  tent: '<path d="M12 3L2 21h20L12 3z"/><path d="M12 3v18M8 21l4-7 4 7"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  sparkle:
    '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  news: '<path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v10a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h3"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  slides: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>',
  page: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  sign: '<path d="M12 3v18M5 6h12l2 2.5L17 11H5zM8 21h8"/>',
  shapes: '<circle cx="7" cy="7" r="4"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M17 3l4 7h-8z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  share:
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S10.5 3 8 3.5 7 8 12 8zM12 8s1.5-5 4-4.5S17 8 12 8z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 13.9L7 22l5-3 5 3-1.5-8.1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  board:
    '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  thumbUp: '<path d="M7 10v11H4V10zM7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
};
/** An inline icon. name: a key of P above (falls back to a dot). */
export function icon(name, size = 20, label = '') {
  return raw(
    `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>${P[name] || P.dot}</svg>`,
  );
}

// ------------------------------------------------------------------ formatting
const DAY = 864e5;
export const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** "Mon 12 Mar" style date for YYYY-MM-DD or ISO. */
export function fmtDate(v, opts = {}) {
  if (!v) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', {
    weekday: opts.weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: sameYear && !opts.year ? undefined : 'numeric',
  });
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
/** "3 min ago", "yesterday", "12 Mar". */
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 7 * 86400) return `${Math.round(s / 86400)} days ago`;
  return fmtDate(iso);
}
/** Days from today to a YYYY-MM-DD date (negative = past). */
export function daysUntil(ymd) {
  if (!ymd) return null;
  return Math.round((Date.parse(ymd + 'T12:00:00') - Date.parse(todayYmd() + 'T12:00:00')) / DAY);
}
/** Due-date label with urgency: "Due in 3 days", "Due today", "4 days late". */
export function dueLabel(ymd, open = true) {
  if (!ymd) return html`<span class="due">No due date</span>`;
  const n = daysUntil(ymd);
  if (!open) return html`<span class="due">Due ${fmtDate(ymd)}</span>`;
  if (n < 0) return html`<span class="due late">${-n} day${n === -1 ? '' : 's'} late</span>`;
  if (n === 0) return html`<span class="due soon">Due today</span>`;
  if (n === 1) return html`<span class="due soon">Due tomorrow</span>`;
  if (n <= 3) return html`<span class="due soon">Due in ${n} days</span>`;
  return html`<span class="due" title="${fmtDate(ymd, { weekday: true })}">Due ${fmtDate(ymd)}</span>`;
}
export const money = (n) => (n == null || n === '' ? '' : '$' + Number(n).toLocaleString('en-US'));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}

// ------------------------------------------------------------------ people
const TINTS = ['#DAFF6B', '#C9D8AE', '#E7ECDF', '#F4F9D1', '#B7C99A', '#D3D6C8', '#E6F0C0'];
export function initials(name, email) {
  const n = (name || email || '?')
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  return ((n[0]?.[0] || '?') + (n.length > 1 ? n[n.length - 1][0] : '')).toUpperCase();
}
export function avatar(email, name, size = '') {
  let h = 0;
  for (const c of email || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return html`<span class="avatar ${size} tint-${h % TINTS.length}" aria-hidden="true">${initials(name, email)}</span>`;
}
/** Name for an email from a names map (API responses include `names`). */
export const nameOf = (email, names = {}) =>
  !email
    ? ''
    : email === 'marketing'
      ? 'Marketing team'
      : names[email] ||
        email
          .split('@')[0]
          .split(/[._-]/)
          .map((w) => w[0]?.toUpperCase() + w.slice(1))
          .join(' ');
export function person(email, names, { size = 'sm', you = '' } = {}) {
  if (!email) return html`<span class="muted">Unassigned</span>`;
  const nm = nameOf(email, names);
  return html`<span class="person" title="${email}"
    >${avatar(email, nm, size)}<span class="nm">${nm}${you && email === you ? ' (you)' : ''}</span></span
  >`;
}

// ------------------------------------------------------------------ status
export function statusBadge(status, extra = '') {
  const s = STATUSES[status] || { label: status, tone: 'muted' };
  return html`<span class="badge t-${s.tone} ${extra}">${s.label}</span>`;
}
export function waitingLabel(req, me, names) {
  const w = req.waiting_on;
  if (!w) return '';
  const you = me && w === me.email;
  return html`<span class="waiting ${you ? 'you' : ''}">Waiting on <strong>${you ? 'you' : nameOf(w, names)}</strong></span>`;
}
export const PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export function priorityLabel(p) {
  if (!p || p === 'normal') return '';
  return html`<span class="prio p-${p}">${icon('flag', 14)}${PRIORITY_LABEL[p]}</span>`;
}

/** A request as a row in a list (home, lists). */
export function requestRow(r, { me, names = {}, showRequester = false, i = 0 } = {}) {
  const open = STATUSES[r.status]?.open;
  return html`<a class="req-row rise" style="--i:${Math.min(i, 8)}" href="/requests/${r.ref}" data-link>
    <div class="stack" style="gap:4px;min-width:0">
      <span class="t">${r.title || 'Untitled request'}</span>
      <span class="meta"
        ><span class="ref">${r.ref}</span><span>${r.type_name}</span>
        ${showRequester ? html`<span>${nameOf(r.requester_email, names)}</span>` : ''}
        ${r.is_rush ? html`<span class="badge plain rush">Rush</span>` : ''}${priorityLabel(r.priority)}
        ${r.open_questions ? html`<span class="prio p-high">${icon('question', 14)}${plural(r.open_questions, 'open question')}</span>` : ''}
      </span>
    </div>
    <div class="side-meta">
      ${statusBadge(r.status)}<span class="row" style="gap:12px"
        >${waitingLabel(r, me, names)}${r.status !== 'draft' ? dueLabel(r.due_date, open && r.status !== 'in_review') : html`<span class="due">Edited ${ago(r.updated_at)}</span>`}</span
      >
    </div>
  </a>`;
}

// ------------------------------------------------------------------ feedback
export function toast(message, { error = false, timeout = 5000, action } = {}) {
  const box = document.querySelector('[data-toasts]');
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' err' : '');
  t.setAttribute('role', error ? 'alert' : 'status');
  t.innerHTML = String(
    html`${icon(error ? 'alert' : 'checkCircle')}<span>${message}</span>${action ? html`<a href="${action.href}" data-link>${action.label}</a>` : ''}<button
        type="button"
        class="icon-btn x"
        aria-label="Dismiss"
      >
        ${icon('x', 18)}
      </button>`,
  );
  t.querySelector('.x').addEventListener('click', () => t.remove());
  while (box.children.length >= 3) box.firstElementChild.remove();
  box.append(t);
  if (timeout) setTimeout(() => t.remove(), timeout);
}

/**
 * A modal dialog. Returns a promise of the submitted form's values (object), or null if cancelled.
 *   await dialog({ title, text, body: html`...form fields...`, confirm: 'Approve', tone: 'primary'|'danger'|'lime' })
 * Fields inside `body` with a name are collected; `required` is enforced by the browser.
 */
export function dialog({ title, text = '', body = '', confirm = 'OK', cancel = 'Cancel', tone = 'primary', wide = false, onOpen } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal';
    if (wide) d.style.width = 'min(760px, calc(100vw - 24px))';
    d.innerHTML = String(
      html`<form method="dialog" novalidate>
        <div class="modal-head">
          <h2>${title}</h2>
          ${text ? html`<p>${text}</p>` : ''}
        </div>
        ${body ? html`<div class="modal-body">${body}</div>` : ''}
        <div class="modal-foot">
          ${cancel ? html`<button type="button" class="btn ghost" value="cancel" data-cancel>${cancel}</button>` : ''}
          <button type="submit" class="btn ${tone}" value="ok">${confirm}</button>
        </div>
      </form>`,
    );
    document.body.append(d);
    const form = d.querySelector('form');
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      d.close();
      d.remove();
      resolve(v);
    };
    d.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(null);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const v = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') v[el.name] = el.checked;
        else if (el.type === 'radio') {
          if (el.checked) v[el.name] = el.value;
        } else v[el.name] = el.value;
      }
      finish(v);
    });
    d.showModal();
    onOpen?.(d);
    (
      d.querySelector('[autofocus]') ||
      d.querySelector('.modal-body input, .modal-body textarea, .modal-body select') ||
      d.querySelector('[type=submit]')
    )?.focus();
  });
}
export const confirmDialog = (title, text, confirm = 'Yes', tone = 'primary') =>
  dialog({ title, text, confirm, tone }).then((v) => v !== null);

export function empty(title, text = '', { art = 'inbox', action = '' } = {}) {
  return html`<div class="empty">
    <div class="art">${icon(art, 28)}</div>
    <h3>${title}</h3>
    ${text ? html`<p>${text}</p>` : ''}${action}
  </div>`;
}
export const spinner = () => html`<div class="page-loading"><span class="spinner" aria-label="Loading"></span></div>`;
export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
/** Set the document title for a screen. */
export const setTitle = (t) => (document.title = t ? `${t} · Marketing requests · Yondr` : 'Marketing requests · Yondr');
