// Shared request helpers: loading, permission checks, participants, the event log and per-type settings.

import { TYPE_BY_ID } from '../../public/js/shared/catalog.js';
import { canView, OPEN_STATUSES } from '../../public/js/shared/workflow.js';
import { fail, now, today } from './http';
import type { Me } from './users';

export interface Req {
  id: number;
  ref: string;
  type_id: string;
  category_id: string;
  title: string;
  status: string;
  prior_status: string | null;
  priority: string;
  is_rush: number;
  rush_reason: string | null;
  requester_email: string;
  approver_email: string | null;
  assignee_email: string | null;
  awaiting_email: string | null;
  department: string | null;
  due_date: string | null;
  brief: string;
  brief_score: number;
  links: string;
  revision_count: number;
  rating: number | null;
  rating_comment: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  approved_at: string | null;
  assigned_at: string | null;
  started_at: string | null;
  first_response_at: string | null;
  first_delivery_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
}

export interface TypeSetting {
  type_id: string;
  enabled: number;
  default_assignee: string | null;
  lead_days: number | null;
  requires_approval: number | null;
}

export const refOf = (id: number) => `MR-${1000 + id}`;

/** Load a request by its ref (MR-1001) or numeric id, or 404. */
export async function load(env: Env, refOrId: string | number): Promise<Req> {
  const q =
    typeof refOrId === 'number' || /^\d+$/.test(String(refOrId))
      ? env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(Number(refOrId))
      : env.DB.prepare('SELECT * FROM requests WHERE ref = ?').bind(String(refOrId).toUpperCase());
  const r = await q.first<Req>();
  if (!r) fail(404, 'We couldn’t find that request.');
  return r;
}

export async function isWatcher(env: Env, id: number, email: string) {
  return !!(await env.DB.prepare('SELECT 1 FROM watchers WHERE request_id = ? AND email = ?').bind(id, email).first());
}

/** Load a request the person may see, or 404 (not 403, so refs can't be probed). */
export async function loadVisible(env: Env, me: Me, ref: string): Promise<Req> {
  const r = await load(env, ref);
  if (!canView(me, r, await isWatcher(env, r.id, me.email))) fail(404, 'We couldn’t find that request.');
  return r;
}

/** Everyone involved: requester, approver, assignee and watchers. */
export async function participants(env: Env, r: Req): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT email FROM watchers WHERE request_id = ?').bind(r.id).all<{ email: string }>();
  return [
    ...new Set([r.requester_email, r.approver_email, r.assignee_email, ...results.map((w) => w.email)].filter((e): e is string => !!e)),
  ];
}

export async function logEvent(
  env: Env,
  r: Pick<Req, 'id'>,
  actor: string,
  action: string,
  from: string | null,
  to: string | null,
  detail: Record<string, unknown> = {},
) {
  await env.DB.prepare(
    'INSERT INTO events (request_id, actor_email, action, from_status, to_status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(r.id, actor, action, from, to, JSON.stringify(detail).slice(0, 8000), now())
    .run();
}

export async function typeSettings(env: Env): Promise<Record<string, TypeSetting>> {
  const { results } = await env.DB.prepare('SELECT * FROM type_settings').all<TypeSetting>();
  return Object.fromEntries(results.map((s) => [s.type_id, s]));
}

/** A type's effective settings: the catalog's defaults, overridden by what admins set. */
export function effective(typeId: string, s?: TypeSetting) {
  const t = TYPE_BY_ID[typeId];
  return {
    enabled: s ? !!s.enabled : true,
    requiresApproval: s && s.requires_approval !== null ? !!s.requires_approval : !!t?.requiresApproval,
    leadDays: s && s.lead_days !== null ? s.lead_days : (t?.leadDays ?? 10),
    defaultAssignee: s?.default_assignee || null,
  };
}

/** Overdue: still with marketing (or waiting on approval or an answer) after the due date. */
export function isOverdue(r: Pick<Req, 'status' | 'due_date'>) {
  return (
    !!r.due_date && r.due_date < today() && ['pending_approval', 'needs_info', 'approved', 'in_progress', 'on_hold'].includes(r.status)
  );
}

export const isOpen = (status: string) => OPEN_STATUSES.includes(status);

/** Mark marketing's first response after approval (for the response-time report). */
export async function touchFirstResponse(env: Env, me: Me, r: Req) {
  if (r.first_response_at || !r.approved_at) return;
  if (!['marketing', 'lead', 'admin'].includes(me.role) || me.email === r.requester_email) return;
  await env.DB.prepare('UPDATE requests SET first_response_at = ? WHERE id = ? AND first_response_at IS NULL').bind(now(), r.id).run();
}
