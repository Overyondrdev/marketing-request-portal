// People and roles.
//   requester  everyone at Yondr: request work, answer questions, review and accept deliverables
//   marketing  + see every request, pick up and produce work, ask questions, deliver, internal notes
//   lead       + approve on anyone's behalf, assign and reassign, routing per request type, reports
//   admin      + people and roles, request-type settings
// Approval is not a role: anyone marked as an approver (managers) can be chosen to approve a request.
// Owners (OWNER_EMAILS secret) are always admins and approvers, and can't be changed from the portal.

import { atLeast } from '../../public/js/shared/workflow.js';
import { now } from './http';

export type Role = 'requester' | 'marketing' | 'lead' | 'admin';
export interface Me {
  email: string;
  name: string | null;
  role: Role;
  owner: boolean;
  is_approver: boolean;
  department: string | null;
  manager_email: string | null;
  title: string | null;
  email_updates: boolean;
  tour_done_at: string | null;
  first_visit: boolean;
}

export function owners(env: Env): string[] {
  return (env.OWNER_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** A readable name from an email when the person hasn't set one: jane.doe@… → Jane Doe. */
export function nameFromEmail(email: string): string {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Record the visit and return who this is. Creates the person's row on first sign-in. */
export async function signIn(env: Env, email: string): Promise<Me> {
  const ts = now();
  const own = owners(env).includes(email);
  const row = await env.DB.prepare(
    `INSERT INTO users (email, name, role, is_approver, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, ?5)
     ON CONFLICT(email) DO UPDATE SET last_seen_at = excluded.last_seen_at,
       first_seen_at = COALESCE(users.first_seen_at, excluded.first_seen_at)
     RETURNING *, (first_seen_at = last_seen_at) AS first_visit`,
  )
    .bind(email, nameFromEmail(email), own ? 'admin' : 'requester', own ? 1 : 0, ts)
    .first<any>();
  return toMe(env, row);
}

function toMe(env: Env, row: any): Me {
  const own = owners(env).includes(row.email);
  return {
    email: row.email,
    name: row.name,
    role: own ? 'admin' : row.role,
    owner: own,
    is_approver: own || !!row.is_approver,
    department: row.department,
    manager_email: row.manager_email,
    title: row.title,
    email_updates: !!row.email_updates,
    tour_done_at: row.tour_done_at,
    first_visit: !!row.first_visit,
  };
}

export const isMarketing = (me: { role: string }) => atLeast(me.role, 'marketing');
export const isLead = (me: { role: string }) => atLeast(me.role, 'lead');
export const isAdmin = (me: { role: string }) => atLeast(me.role, 'admin');

/** Marketing leads and admins (incl. owners): they triage unassigned work. */
export async function leads(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT email FROM users WHERE role IN ('lead', 'admin') AND active = 1").all<{
    email: string;
  }>();
  return [...new Set([...owners(env), ...results.map((r) => r.email)])];
}

/** Names for a set of emails, for display. */
export async function namesFor(env: Env, emails: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = [...new Set(emails.filter((e): e is string => !!e))];
  const out: Record<string, string> = {};
  for (const e of list) out[e] = nameFromEmail(e);
  if (!list.length) return out;
  for (let i = 0; i < list.length; i += 90) {
    const chunk = list.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT email, name FROM users WHERE email IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ email: string; name: string | null }>();
    for (const r of results) if (r.name) out[r.email] = r.name;
  }
  return out;
}

/** Make sure a person exists (e.g. an approver who hasn't signed in yet), so they can be notified and named. */
export async function ensureUser(env: Env, email: string, addedBy: string) {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO users (email, name, role, added_by, created_at, updated_at) VALUES (?1, ?2, 'requester', ?3, ?4, ?4)
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(email, nameFromEmail(email), addedBy, ts)
    .run();
}

export async function audit(env: Env, actor: string, action: string, target: string | null, detail: unknown = {}) {
  await env.DB.prepare('INSERT INTO audit (actor_email, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(actor, action, target, JSON.stringify(detail).slice(0, 8000), now())
    .run();
}
