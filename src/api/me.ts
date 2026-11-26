// The signed-in person: who am I, my settings, the people directory (for approver/assignee/watcher pickers) and
// the catalog's live settings.

import { TYPES } from '../../public/js/shared/catalog.js';
import { atLeast } from '../../public/js/shared/workflow.js';
import { allowedDomain } from '../lib/access';
import { body, fail, isEmail, json, now, str } from '../lib/http';
import { emailEnabled } from '../lib/notify';
import { effective, typeSettings } from '../lib/requests';
import { ensureUser, nameFromEmail, owners, type Me } from '../lib/users';

export async function whoami(env: Env, me: Me) {
  const counts = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM requests WHERE approver_email = ?1 AND status = 'pending_approval') AS approvals,
      (SELECT COUNT(*) FROM notifications WHERE email = ?1 AND read_at IS NULL) AS unread,
      (SELECT COUNT(*) FROM requests WHERE status = 'approved' AND assignee_email IS NULL) AS unassigned`,
  )
    .bind(me.email)
    .first<any>();
  return json({
    me,
    counts: {
      approvals: counts?.approvals || 0,
      unread: counts?.unread || 0,
      unassigned: atLeast(me.role, 'marketing') ? counts?.unassigned || 0 : 0,
    },
    email_enabled: emailEnabled(env),
  });
}

export async function saveProfile(env: Env, me: Me, request: Request) {
  const b = await body(request);
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (c: string, v: unknown) => {
    sets.push(`${c} = ?`);
    args.push(v);
  };
  if ('name' in b) set('name', str(b.name, 80) || nameFromEmail(me.email));
  if ('title' in b) set('title', str(b.title, 80) || null);
  if ('department' in b) set('department', str(b.department, 80) || null);
  if ('email_updates' in b) set('email_updates', b.email_updates ? 1 : 0);
  if ('tour_done' in b) set('tour_done_at', b.tour_done ? now() : null);
  if ('manager_email' in b) {
    const m = b.manager_email ? String(b.manager_email).trim().toLowerCase() : null;
    if (m && (!isEmail(m) || !allowedDomain(env, m))) fail(400, 'Choose a manager with a Yondr email address.');
    if (m === me.email) fail(400, 'Choose someone other than yourself.');
    if (m) await ensureUser(env, m, me.email);
    set('manager_email', m);
  }
  if (sets.length)
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE email = ?`)
      .bind(...args, now(), me.email)
      .run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(me.email).first<any>();
  return json({ me: { ...me, ...row, role: me.role, owner: me.owner, is_approver: me.is_approver, email_updates: !!row.email_updates } });
}

/** Everyone who has used the portal or was added, for pickers. Approvers and marketing are flagged. */
export async function directory(env: Env) {
  const { results } = await env.DB.prepare(
    'SELECT email, name, title, department, role, is_approver FROM users WHERE active = 1 ORDER BY COALESCE(name, email)',
  ).all<any>();
  const own = owners(env);
  return json({
    people: results.map((p) => ({
      ...p,
      name: p.name || nameFromEmail(p.email),
      is_approver: own.includes(p.email) || !!p.is_approver,
      role: own.includes(p.email) ? 'admin' : p.role,
    })),
  });
}

/** Admin overrides for each request type (enabled, turnaround, approval). Assignees stay internal. */
export async function catalogSettings(env: Env) {
  const s = await typeSettings(env);
  return json({
    settings: Object.fromEntries(
      TYPES.map((t) => {
        const e = effective(t.id, s[t.id]);
        return [t.id, { enabled: e.enabled, requiresApproval: e.requiresApproval, leadDays: e.leadDays }];
      }),
    ),
  });
}
