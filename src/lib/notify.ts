// Notifications: the in-app inbox (the bell) for everyone, plus email (Resend) and optional Slack.
//   - Email goes out when EMAIL_ENABLED is "on" and the RESEND_API_KEY secret is set. Emails that ask someone to act
//     (approve, answer, review) always send; plain updates respect each person's "Email me updates" setting.
//   - Slack: set the SLACK_WEBHOOK_URL secret to post new and overdue work to the marketing channel.
// Sending never blocks or fails the action that caused it: it runs in ctx.waitUntil and errors are logged.

import { now } from './http';
import { nameFromEmail } from './users';

export interface Note {
  kind: string;
  actor: string;
  request: { id: number; ref: string; title: string; type_name?: string };
  text: string; // one sentence, shown in the bell and as the email's lead
  actionNeeded?: boolean; // the recipient has to do something
  subject?: string;
  detail?: { label: string; value: string }[]; // extra rows in the email
  quote?: string; // a comment or note to show in the email
  cta?: string; // button label
  slack?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function requestUrl(env: Env, ref: string) {
  return ref ? `${env.APP_URL || ''}/requests/${ref}` : `${env.APP_URL || ''}/`;
}

export const RESEND_API = 'https://api.resend.com/emails/batch';
export const emailEnabled = (env: Env) => env.EMAIL_ENABLED === 'on' && !!env.RESEND_API_KEY;

export async function notify(env: Env, ctx: ExecutionContext | undefined, to: (string | null | undefined)[], n: Note) {
  const people = [...new Set(to.filter((e): e is string => !!e && e !== n.actor && e !== 'marketing'))];
  const ts = now();
  if (people.length) {
    await env.DB.batch(
      people
        .slice(0, 100)
        .map((email) =>
          env.DB.prepare(
            'INSERT INTO notifications (email, request_id, kind, actor_email, text, action_needed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).bind(email, n.request.id || null, n.kind, n.actor, n.text.slice(0, 500), n.actionNeeded ? 1 : 0, ts),
        ),
    );
  }
  const work: Promise<unknown>[] = [];
  if (people.length && emailEnabled(env)) work.push(sendEmails(env, people, n));
  if (n.slack && env.SLACK_WEBHOOK_URL) work.push(postSlack(env, n));
  if (!work.length) return;
  const all = Promise.allSettled(work).then((r) => r.forEach((x) => x.status === 'rejected' && console.error('notify', x.reason)));
  if (ctx) ctx.waitUntil(all);
  else await all;
}

async function sendEmails(env: Env, people: string[], n: Note) {
  let recipients = people;
  if (!n.actionNeeded) {
    const { results } = await env.DB.prepare(
      `SELECT email FROM users WHERE email IN (${people.map(() => '?').join(',')}) AND (email_updates = 0 OR active = 0)`,
    )
      .bind(...people)
      .all<{ email: string }>();
    const off = new Set(results.map((r) => r.email));
    recipients = people.filter((e) => !off.has(e));
  }
  const { results: named } = await env.DB.prepare(
    `SELECT email, name FROM users WHERE email IN (${[n.actor, ...recipients].map(() => '?').join(',')})`,
  )
    .bind(n.actor, ...recipients)
    .all<{ email: string; name: string | null }>();
  const names = Object.fromEntries(named.map((r) => [r.email, r.name || nameFromEmail(r.email)]));
  const subject = n.subject || `${n.request.ref}: ${n.request.title || 'Marketing request'}`;
  const { html, text } = renderEmail(env, n);
  if (!recipients.length) return;
  const fromName = (env.MAIL_FROM_NAME || 'Yondr Marketing Requests').replace(/["<>]/g, '');
  const address = (email: string) => `${(names[email] || nameFromEmail(email)).replace(/["<>]/g, '')} <${email}>`;
  // One message per person, so nobody sees who else was told and replies stay private. Resend's batch endpoint
  // sends up to 100 messages in one call.
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100).map((email) => ({
      from: `${fromName} <${env.MAIL_FROM}>`,
      to: [address(email)],
      ...(n.actor && n.actor.includes('@') ? { reply_to: [address(n.actor)] } : {}),
      subject,
      html,
      text,
      tags: [{ name: 'kind', value: n.kind.replace(/[^\w-]/g, '_') }],
    }));
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        // Resend ignores a repeat with the same key (e.g. a retried Worker), so nobody gets the email twice.
        'idempotency-key': `${n.request.ref || 'none'}-${n.kind}-${Date.now()}-${i}`.slice(0, 256),
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) console.error('resend', res.status, (await res.text()).slice(0, 500));
  }
}

export function renderEmail(env: Env, n: Note): { html: string; text: string } {
  const url = requestUrl(env, n.request.ref);
  const rows = [...(n.request.type_name ? [{ label: 'Request', value: n.request.type_name }] : []), ...(n.detail || [])].filter(
    (r) => r.value,
  );
  const cta = n.cta || (n.actionNeeded ? 'Open the request' : 'View the request');
  const html = `<!doctype html><html><body style="margin:0;background:#FAFBF7;font-family:'Inter Tight',Arial,sans-serif;color:#1E1E1E">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFBF7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E7ECDF;border-radius:16px;overflow:hidden">
<tr><td style="background:#1C300B;padding:18px 28px;color:#F4F9D1;font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:600">Yondr · Marketing requests</td></tr>
<tr><td style="padding:28px">
${n.request.ref ? `<p style="margin:0 0 6px;font-size:13px;color:#4F6B35;font-weight:600">${esc(n.request.ref)}</p>` : ''}
<h1 style="margin:0 0 16px;font-family:Fraunces,Georgia,serif;font-weight:500;font-size:24px;line-height:1.25;color:#1C300B">${esc(n.request.title || 'Marketing request')}</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">${esc(n.text)}</p>
${n.quote ? `<blockquote style="margin:0 0 20px;padding:12px 16px;background:#F4F9D1;border-left:3px solid #9DAE7E;border-radius:8px;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(n.quote.slice(0, 1500))}</blockquote>` : ''}
${
  rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;font-size:14px;line-height:1.5">${rows
        .map(
          (r) =>
            `<tr><td style="padding:3px 16px 3px 0;color:#4F6B35;white-space:nowrap;vertical-align:top">${esc(r.label)}</td><td style="padding:3px 0;white-space:pre-wrap">${esc(r.value.slice(0, 600))}</td></tr>`,
        )
        .join('')}</table>`
    : ''
}
<a href="${esc(url)}" style="display:inline-block;background:${n.actionNeeded ? '#DAFF6B' : '#1C300B'};color:${n.actionNeeded ? '#1C300B' : '#F4F9D1'};text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:999px">${esc(cta)}</a>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #E7ECDF;font-size:12px;color:#4F6B35">You get this because you're part of this request. Change email settings in the portal under your name → Settings.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `${n.request.ref}: ${n.request.title || 'Marketing request'}`,
    '',
    n.text,
    ...(n.quote ? ['', n.quote] : []),
    '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '',
    `${cta}: ${url}`,
  ].join('\n');
  return { html, text };
}

async function postSlack(env: Env, n: Note) {
  const url = requestUrl(env, n.request.ref);
  await fetch(env.SLACK_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `${n.text} <${url}|${n.request.ref}: ${n.request.title.replace(/[<>|]/g, '')}>` }),
  });
}

// ------------------------------------------------------------------ the bell
export async function inbox(env: Env, email: string) {
  const [items, unread] = await env.DB.batch([
    env.DB.prepare(
      `SELECT n.id, n.kind, n.text, n.actor_email, n.action_needed, n.created_at, n.read_at, r.ref, r.title
       FROM notifications n LEFT JOIN requests r ON r.id = n.request_id WHERE n.email = ? ORDER BY n.id DESC LIMIT 50`,
    ).bind(email),
    env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE email = ? AND read_at IS NULL').bind(email),
  ]);
  return { items: items.results, unread: (unread.results[0] as any)?.n || 0 };
}

export async function markRead(env: Env, email: string, b: { all?: boolean; id?: number; ref?: string }) {
  const ts = now();
  if (b.all) await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE email = ? AND read_at IS NULL').bind(ts, email).run();
  else if (Number.isInteger(b.id))
    await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE email = ? AND id = ?').bind(ts, email, b.id).run();
  else if (b.ref)
    await env.DB.prepare(
      'UPDATE notifications SET read_at = ? WHERE email = ? AND read_at IS NULL AND request_id = (SELECT id FROM requests WHERE ref = ?)',
    )
      .bind(ts, email, b.ref)
      .run();
}
