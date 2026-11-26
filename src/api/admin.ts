// Admin: people and roles (admins), request-type settings and routing (leads and admins), audit log.

import { TYPES, TYPE_BY_ID } from '../../public/js/shared/catalog.js';
import { ROLES } from '../../public/js/shared/workflow.js';
import { allowedDomain } from '../lib/access';
import { body, fail, isEmail, json, now, str } from '../lib/http';
import { notify } from '../lib/notify';
import { typeSettings } from '../lib/requests';
import { audit, ensureUser, isAdmin, isLead, nameFromEmail, owners, type Me } from '../lib/users';

const ROLE_NAMES: Record<string, string> = {
  requester: 'a requester',
  marketing: 'on the marketing team',
  lead: 'a marketing lead',
  admin: 'an admin',
};

export async function people(env: Env, me: Me) {
  if (!isLead(me)) fail(403, 'Only marketing leads and admins can manage people.');
  const own = owners(env);
  const [users, log] = await env.DB.batch([
    env.DB.prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM requests r WHERE r.requester_email = u.email AND r.status <> 'draft') AS requests,
              (SELECT COUNT(*) FROM requests r WHERE r.assignee_email = u.email AND r.status IN ('approved','in_progress','on_hold','needs_info')) AS open_assigned
       FROM users u ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'lead' THEN 1 WHEN 'marketing' THEN 2 ELSE 3 END, COALESCE(u.name, u.email)`,
    ),
    env.DB.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 60'),
  ]);
  const list = (users.results as any[]).map((u) => ({
    ...u,
    owner: own.includes(u.email),
    role: own.includes(u.email) ? 'admin' : u.role,
    is_approver: own.includes(u.email) ? 1 : u.is_approver,
  }));
  for (const o of own)
    if (!list.some((u) => u.email === o))
      list.unshift({ email: o, name: nameFromEmail(o), role: 'admin', owner: true, is_approver: 1, active: 1 });
  return json({ people: list, audit: log.results, roles: ROLES, can_edit_roles: isAdmin(me) });
}

/** Add or update a person: role (admins), approver flag, manager and department (leads and admins). */
export async function savePerson(env: Env, ctx: ExecutionContext, me: Me, target: string, request: Request) {
  if (!isLead(me)) fail(403, 'Only marketing leads and admins can manage people.');
  const email = decodeURIComponent(target).trim().toLowerCase();
  if (!isEmail(email) || !allowedDomain(env, email)) fail(400, 'Use a Yondr email address.');
  const b = await body(request);
  const own = owners(env).includes(email);
  await ensureUser(env, email, me.email);
  const before = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<any>();
  const sets: string[] = [];
  const args: unknown[] = [];
  const changes: Record<string, unknown> = {};
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    args.push(v);
    changes[col] = v;
  };

  if ('role' in b && b.role !== before.role) {
    if (!isAdmin(me)) fail(403, 'Only admins can change roles.');
    if (!ROLES.includes(b.role)) fail(400, 'Unknown role.');
    if (own) fail(400, 'Owners are set in the portal’s configuration and are always admins.');
    if (email === me.email) fail(400, 'You can’t change your own role. Ask another admin.');
    set('role', b.role);
  }
  if ('is_approver' in b) set('is_approver', b.is_approver ? 1 : 0);
  if ('name' in b) set('name', str(b.name, 80) || null);
  if ('title' in b) set('title', str(b.title, 80) || null);
  if ('department' in b) set('department', str(b.department, 80) || null);
  if ('manager_email' in b) {
    const m = b.manager_email ? String(b.manager_email).trim().toLowerCase() : null;
    if (m && (!isEmail(m) || !allowedDomain(env, m) || m === email)) fail(400, 'Choose a different Yondr colleague as manager.');
    if (m) await ensureUser(env, m, me.email);
    set('manager_email', m);
  }
  if ('active' in b) {
    if (email === me.email) fail(400, 'You can’t deactivate yourself.');
    set('active', b.active ? 1 : 0);
  }
  if (sets.length) {
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')}, added_by = COALESCE(added_by, ?), updated_at = ? WHERE email = ?`)
      .bind(...args, me.email, now(), email)
      .run();
    await audit(env, me.email, 'person_updated', email, changes);
    if ('role' in changes)
      await notify(env, ctx, [email], {
        kind: 'role',
        actor: me.email,
        request: { id: 0, ref: '', title: 'Your access changed' },
        text: `${me.name || me.email} made you ${ROLE_NAMES[changes.role as string]} in the marketing request portal.`,
      }).catch(() => {});
  }
  return people(env, me);
}

export async function types(env: Env, me: Me) {
  if (!isLead(me)) fail(403, 'Only marketing leads and admins can change request types.');
  const s = await typeSettings(env);
  return json({
    types: TYPES.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      requiresApproval: t.requiresApproval,
      settings: s[t.id] || null,
    })),
  });
}

export async function saveType(env: Env, me: Me, typeId: string, request: Request) {
  if (!isLead(me)) fail(403, 'Only marketing leads and admins can change request types.');
  if (!TYPE_BY_ID[typeId]) fail(404, 'Unknown request type.');
  const b = await body(request);
  const cur = (await typeSettings(env))[typeId] || { enabled: 1, default_assignee: null, lead_days: null, requires_approval: null };
  const next = { ...cur };
  if ('enabled' in b) next.enabled = b.enabled ? 1 : 0;
  if ('default_assignee' in b) {
    const a = b.default_assignee ? String(b.default_assignee).trim().toLowerCase() : null;
    if (a) {
      const u = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(a).first<{ role: string }>();
      if (!owners(env).includes(a) && (!u || u.role === 'requester')) fail(400, 'Choose someone on the marketing team.');
    }
    next.default_assignee = a;
  }
  if ('requires_approval' in b) next.requires_approval = b.requires_approval === null ? null : b.requires_approval ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO type_settings (type_id, enabled, default_assignee, requires_approval, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(type_id) DO UPDATE SET enabled = excluded.enabled, default_assignee = excluded.default_assignee,
       requires_approval = excluded.requires_approval, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(typeId, next.enabled, next.default_assignee, next.requires_approval, me.email, now())
    .run();
  const { lead_days: _unused, ...logged } = next as any;
  await audit(env, me.email, 'type_updated', typeId, logged);
  return types(env, me);
}
