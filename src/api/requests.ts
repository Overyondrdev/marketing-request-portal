// Requests: list, home summary, create (draft), read, edit, and every workflow action.

import {
  TYPE_BY_ID,
  validateBrief,
  cleanBrief,
  briefScore,
  earliestStandardDate,
  visibleFields,
  formatAnswer,
} from '../../public/js/shared/catalog.js';
import { ACTIONS, STATUSES, availableActions, can, canEditBrief, waitingOn, relation } from '../../public/js/shared/workflow.js';
import { allowedDomain } from '../lib/access';
import { body, fail, isEmail, json, now, parse, str, today, ymd } from '../lib/http';
import { notify, type Note } from '../lib/notify';
import {
  effective,
  isOverdue,
  isWatcher,
  load,
  loadVisible,
  logEvent,
  participants,
  refOf,
  touchFirstResponse,
  typeSettings,
  type Req,
} from '../lib/requests';
import { ensureUser, isLead, isMarketing, leads, namesFor, type Me } from '../lib/users';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const LIST_COLUMNS = `id, ref, type_id, category_id, title, status, prior_status, priority, is_rush, requester_email, approver_email,
  assignee_email, awaiting_email, department, due_date, brief_score, revision_count, rating, created_at, updated_at, submitted_at,
  approved_at, started_at, first_delivery_at, completed_at, closed_at`;

function summary(r: Req | any) {
  return {
    ...r,
    type_name: TYPE_BY_ID[r.type_id]?.name || r.type_id,
    status_label: STATUSES[r.status as keyof typeof STATUSES]?.label || r.status,
    waiting_on: waitingOn(r),
    overdue: isOverdue(r),
  };
}

// ------------------------------------------------------------------ list
export async function list(env: Env, me: Me, url: URL) {
  const p = url.searchParams;
  const scope = p.get('scope') || 'mine';
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, ...v: unknown[]) => {
    where.push(sql);
    args.push(...v);
  };

  switch (scope) {
    case 'mine':
      add('requester_email = ?', me.email);
      break;
    case 'approvals':
      add('approver_email = ?', me.email);
      if (!p.get('status')) add("status = 'pending_approval'");
      break;
    case 'assigned':
      add('assignee_email = ?', me.email);
      break;
    case 'watching':
      add('id IN (SELECT request_id FROM watchers WHERE email = ?)', me.email);
      break;
    case 'involved':
      add(
        '(requester_email = ? OR approver_email = ? OR assignee_email = ? OR id IN (SELECT request_id FROM watchers WHERE email = ?))',
        me.email,
        me.email,
        me.email,
        me.email,
      );
      break;
    case 'all':
      if (!isMarketing(me)) fail(403, 'Only the marketing team can see every request.');
      add("status <> 'draft'");
      break;
    default:
      fail(400, 'Unknown list.');
  }
  if (scope !== 'mine' && scope !== 'all') add("status <> 'draft'");

  const statuses = (p.get('status') || '').split(',').filter((s) => s in STATUSES);
  if (statuses.length) add(`status IN (${statuses.map(() => '?').join(',')})`, ...statuses);
  if (p.get('open') === '1') add("status NOT IN ('completed', 'cancelled')");
  const types = (p.get('type') || '').split(',').filter((t) => t in TYPE_BY_ID);
  if (types.length) add(`type_id IN (${types.map(() => '?').join(',')})`, ...types);
  if (p.get('category')) add('category_id = ?', p.get('category'));
  if (p.get('priority')) add('priority = ?', p.get('priority'));
  const assignee = p.get('assignee');
  if (assignee === 'none') add('assignee_email IS NULL');
  else if (assignee) add('assignee_email = ?', assignee.toLowerCase());
  if (p.get('requester')) add('requester_email = ?', p.get('requester')!.toLowerCase());
  if (p.get('department')) add('department = ?', p.get('department'));
  if (p.get('overdue') === '1')
    add("due_date < ? AND status IN ('pending_approval','needs_info','approved','in_progress','on_hold')", today());
  const from = ymd(p.get('from')),
    to = ymd(p.get('to'));
  if (from) add('COALESCE(submitted_at, created_at) >= ?', from);
  if (to) add('COALESCE(submitted_at, created_at) < ?', to + 'T99');
  const q = str(p.get('q'), 100);
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    add('(title LIKE ? OR ref LIKE ? OR requester_email LIKE ? OR brief LIKE ?)', like, like, like, like);
  }

  const sorts: Record<string, string> = {
    updated: 'updated_at DESC',
    due: 'CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, id DESC',
    created: 'id DESC',
    priority: "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, due_date ASC",
  };
  const order = sorts[p.get('sort') || 'updated'] || sorts.updated;
  const limit = Math.min(Math.max(Number(p.get('limit')) || 200, 1), 1000);
  const { results } = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS},
       (SELECT COUNT(*) FROM comments c WHERE c.request_id = requests.id AND c.kind IN ('comment','question')) AS comment_count,
       (SELECT COUNT(*) FROM comments c WHERE c.request_id = requests.id AND c.kind = 'question' AND c.resolved_at IS NULL) AS open_questions
     FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${limit}`,
  )
    .bind(...args)
    .all<any>();
  const items = results.map(summary);
  const names = await namesFor(
    env,
    items.flatMap((r) => [r.requester_email, r.approver_email, r.assignee_email]),
  );
  return json({ items, names });
}

// ------------------------------------------------------------------ home: what needs me, what's mine
export async function home(env: Env, me: Me) {
  const t = today();
  const stmts = [
    // Waiting on me (as requester, approver, assignee, or a question addressed to me).
    env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM requests WHERE
        (requester_email = ?1 AND status IN ('in_review','rejected'))
        OR (approver_email = ?1 AND status = 'pending_approval')
        OR (status = 'needs_info' AND COALESCE(awaiting_email, requester_email) = ?1)
        OR (assignee_email = ?1 AND status IN ('approved','in_progress'))
        OR id IN (SELECT request_id FROM comments WHERE to_email = ?1 AND kind = 'question' AND resolved_at IS NULL)
       ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date LIMIT 100`,
    ).bind(me.email),
    env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM requests WHERE requester_email = ? AND (status NOT IN ('completed','cancelled') OR closed_at > ?)
       ORDER BY updated_at DESC LIMIT 100`,
    ).bind(me.email, new Date(Date.now() - 14 * 864e5).toISOString()),
    env.DB.prepare(
      `SELECT ${LIST_COLUMNS} FROM requests WHERE status NOT IN ('draft','completed','cancelled')
        AND id IN (SELECT request_id FROM watchers WHERE email = ?) ORDER BY updated_at DESC LIMIT 50`,
    ).bind(me.email),
  ];
  if (isMarketing(me)) {
    stmts.push(
      env.DB.prepare(
        `SELECT
          SUM(status = 'approved' AND assignee_email IS NULL) AS unassigned,
          SUM(status IN ('approved','in_progress','on_hold','needs_info')) AS active,
          SUM(status = 'in_review') AS in_review,
          SUM(status = 'pending_approval') AS pending_approval,
          SUM(due_date < ?1 AND status IN ('pending_approval','needs_info','approved','in_progress','on_hold')) AS overdue,
          SUM(due_date BETWEEN ?1 AND ?2 AND status IN ('approved','in_progress','on_hold','needs_info')) AS due_this_week,
          SUM(completed_at >= ?3) AS completed_30d
         FROM requests`,
      ).bind(t, new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), new Date(Date.now() - 30 * 864e5).toISOString()),
    );
  }
  const res = await env.DB.batch(stmts);
  const waiting = res[0].results.map(summary);
  const mine = res[1].results.map(summary);
  const watching = res[2].results.map(summary);
  const names = await namesFor(
    env,
    [...waiting, ...mine, ...watching].flatMap((r) => [r.requester_email, r.approver_email, r.assignee_email]),
  );
  return json({ waiting, mine, watching, names, team: isMarketing(me) ? res[3].results[0] : null });
}

// ------------------------------------------------------------------ create a draft
export async function create(env: Env, me: Me, request: Request) {
  const b = await body(request);
  let typeId = str(b.type_id, 60);
  let brief: Record<string, unknown> = {};
  let title = str(b.title, 160);
  let from: Req | null = null;
  if (b.duplicate_of) {
    from = await loadVisible(env, me, str(b.duplicate_of, 20));
    typeId = from.type_id;
    brief = parse(from.brief, {});
    title = title || `${from.title} (copy)`;
  }
  const type = TYPE_BY_ID[typeId];
  if (!type) fail(400, 'Choose what you need first.');
  const settings = effective(typeId, (await typeSettings(env))[typeId]);
  if (!settings.enabled) fail(400, 'That kind of request isn’t available right now. Choose another or “Something else”.');
  const ts = now();
  const row = await env.DB.prepare(
    `INSERT INTO requests (type_id, category_id, title, requester_email, approver_email, department, brief, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(typeId, type.category, title, me.email, me.manager_email, me.department, JSON.stringify(brief), ts, ts)
    .first<{ id: number }>();
  const id = row!.id;
  await env.DB.prepare('UPDATE requests SET ref = ? WHERE id = ?').bind(refOf(id), id).run();
  await logEvent(env, { id }, me.email, from ? 'duplicated' : 'created', null, 'draft', from ? { from: from.ref } : {});
  return get(env, me, refOf(id), 201);
}

// ------------------------------------------------------------------ read one
export async function get(env: Env, me: Me, ref: string, status = 200) {
  const r = await loadVisible(env, me, ref);
  const mk = isMarketing(me);
  const [comments, files, events, watchers] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM comments WHERE request_id = ? ${mk ? '' : "AND kind <> 'internal'"} ORDER BY id`).bind(r.id),
    env.DB.prepare(
      'SELECT id, kind, name, content_type, size, version, uploaded_by, created_at FROM files WHERE request_id = ? AND deleted_at IS NULL ORDER BY created_at',
    ).bind(r.id),
    env.DB.prepare('SELECT * FROM events WHERE request_id = ? ORDER BY id').bind(r.id),
    env.DB.prepare('SELECT email, added_by, created_at FROM watchers WHERE request_id = ? ORDER BY created_at').bind(r.id),
  ]);
  const settings = effective(r.type_id, (await typeSettings(env))[r.type_id]);
  const people = [
    r.requester_email,
    r.approver_email,
    r.assignee_email,
    r.awaiting_email,
    ...(comments.results as any[]).flatMap((c) => [c.author_email, c.to_email]),
    ...(events.results as any[]).map((e) => e.actor_email),
    ...(watchers.results as any[]).map((w) => w.email),
    ...(files.results as any[]).map((f) => f.uploaded_by),
  ];
  const names = await namesFor(env, people);
  const watching = (watchers.results as any[]).some((w) => w.email === me.email);
  return json(
    {
      request: { ...summary(r), brief: parse(r.brief, {}), links: parse(r.links, []) },
      comments: comments.results,
      files: files.results,
      events: (events.results as any[]).map((e) => ({ ...e, detail: parse(e.detail, {}) })),
      watchers: watchers.results,
      names,
      settings,
      me: {
        actions: availableActions(me, r),
        can_edit: canEditBrief(me, r),
        can_manage: mk && r.status !== 'draft',
        watching,
        relation: relation(me, r),
      },
    },
    status,
  );
}

// ------------------------------------------------------------------ edit
export async function patch(env: Env, me: Me, ref: string, request: Request) {
  const r = await loadVisible(env, me, ref);
  const b = await body(request);
  const rel = relation(me, r);
  const mk = isMarketing(me) && r.status !== 'draft';
  const editBrief = canEditBrief(me, r);
  if (!editBrief && !mk) fail(403, 'This request can’t be edited now. Add a comment instead.');
  const type = TYPE_BY_ID[r.type_id];
  const sets: string[] = [];
  const args: unknown[] = [];
  const changed: string[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    args.push(v);
    changed.push(col);
  };

  if ('title' in b) set('title', str(b.title, 160));
  if ('brief' in b && editBrief) {
    if (!b.brief || typeof b.brief !== 'object') fail(400, 'The brief should be an object.');
    const brief = r.status === 'draft' ? b.brief : cleanBrief(type, b.brief);
    const text = JSON.stringify(brief);
    if (text.length > 60_000) fail(413, 'The brief is too long. Attach a document instead.');
    set('brief', text);
  }
  if ('due_date' in b) {
    const d = b.due_date === null ? null : ymd(b.due_date);
    if (b.due_date !== null && !d) fail(400, 'Enter the due date as YYYY-MM-DD.');
    set('due_date', d);
  }
  if ('priority' in b) {
    if (!PRIORITIES.includes(b.priority)) fail(400, 'Unknown priority.');
    set('priority', b.priority);
  }
  if ('rush_reason' in b) set('rush_reason', str(b.rush_reason, 1000) || null);
  if ('department' in b) set('department', str(b.department, 80) || null);
  if ('approver_email' in b) {
    if (!(rel.requester && ['draft', 'pending_approval', 'rejected'].includes(r.status)) && !isLead(me))
      fail(403, 'Only the requester (before approval) or a marketing lead can change the approver.');
    const a = b.approver_email ? String(b.approver_email).trim().toLowerCase() : null;
    if (a && (!isEmail(a) || !allowedDomain(env, a))) fail(400, 'Choose an approver with a Yondr email address.');
    if (a && a === r.requester_email) fail(400, 'Someone else needs to approve your request. Choose your manager.');
    if (a) await ensureUser(env, a, me.email);
    set('approver_email', a);
  }
  if ('links' in b && mk) {
    const links = Array.isArray(b.links) ? b.links : [];
    const clean = links
      .slice(0, 20)
      .map((l: any) => ({ label: str(l?.label, 80), url: str(l?.url, 1000) }))
      .filter((l: any) => /^https?:\/\//i.test(l.url));
    set('links', JSON.stringify(clean));
  }
  if (!sets.length) return get(env, me, r.ref);
  // Requesters edit the brief; marketing can also change title, due date, priority and links on open requests.
  if (!editBrief && changed.some((c) => !['title', 'due_date', 'priority', 'links'].includes(c)))
    fail(403, 'You can change the title, due date, priority and links of this request.');
  sets.push('updated_at = ?');
  args.push(now());
  await env.DB.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...args, r.id)
    .run();

  if (r.status !== 'draft') {
    const keyChanges = changed.filter((c) => c !== 'brief' || r.status !== 'draft');
    if (keyChanges.length)
      await logEvent(env, r, me.email, 'edited', r.status, r.status, {
        fields: keyChanges,
        ...('due_date' in b ? { due_date: { from: r.due_date, to: b.due_date } } : {}),
        ...('priority' in b ? { priority: { from: r.priority, to: b.priority } } : {}),
      });
    await touchFirstResponse(env, me, r);
  }
  return get(env, me, r.ref);
}

// ------------------------------------------------------------------ delete a draft
export async function removeDraft(env: Env, me: Me, ref: string) {
  const r = await loadVisible(env, me, ref);
  if (r.status !== 'draft' || r.requester_email !== me.email)
    fail(400, 'Only your own drafts can be deleted. Cancel a submitted request instead.');
  const { results } = await env.DB.prepare('SELECT r2_key FROM files WHERE request_id = ?').bind(r.id).all<{ r2_key: string }>();
  if (results.length) await env.FILES.delete(results.map((f) => f.r2_key));
  await env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(r.id).run();
  return json({ ok: true });
}

// ------------------------------------------------------------------ workflow actions
export async function act(env: Env, ctx: ExecutionContext, me: Me, ref: string, action: string, request: Request) {
  const r = await loadVisible(env, me, ref);
  const def = (ACTIONS as Record<string, any>)[action];
  if (!def) fail(404, 'Unknown action.');
  if (!can(me, r, action)) {
    fail(
      r.status === 'pending_approval' && (action === 'approve' || action === 'reject') && r.requester_email === me.email ? 403 : 409,
      r.status in STATUSES && !def.from.includes(r.status)
        ? `This request is “${STATUSES[r.status as keyof typeof STATUSES].label}”, so it can’t be ${def.label.toLowerCase()} now. Refresh to see the latest.`
        : 'You can’t do that on this request.',
    );
  }
  const b = await body(request);
  const note = str(b.note, 5000);
  if (def.needs?.includes('note') && !note) fail(400, 'Add a short note so everyone knows why.');

  const type = TYPE_BY_ID[r.type_id];
  const ts = now();
  const settings = effective(r.type_id, (await typeSettings(env))[r.type_id]);
  const updates: Record<string, unknown> = { updated_at: ts };
  let to: string = def.to === 'prior' ? r.prior_status || 'in_progress' : def.to || r.status;
  const detail: Record<string, unknown> = note ? { note } : {};
  const after: (() => Promise<unknown>)[] = [];
  const rq = { id: r.id, ref: r.ref, title: r.title, type_name: type?.name };
  const who = (e: string | null) => (e ? e.split('@')[0] : 'someone');
  const myName = me.name || who(me.email);

  switch (action) {
    case 'submit':
    case 'resubmit': {
      const brief = parse<Record<string, unknown>>(r.brief, {});
      if (!settings.enabled) fail(400, 'That kind of request isn’t available right now.');
      const errors = validateBrief(type, brief);
      if (str(r.title).length < 3) errors.title = 'Give the request a short name.';
      if (!r.due_date) errors.due_date = 'When do you need it?';
      else if (r.due_date < today()) errors.due_date = 'The due date is in the past.';
      const earliest = earliestStandardDate(type, brief, today(), settings);
      const rush = !!r.due_date && r.due_date < earliest;
      if (rush && !str(r.rush_reason)) errors.rush_reason = 'This is faster than the usual turnaround. Tell us why it can’t move.';
      const needsApproval = settings.requiresApproval && !isLead(me);
      if (needsApproval && !r.approver_email) errors.approver_email = 'Choose who approves this (usually your manager).';
      if (needsApproval && r.approver_email === me.email) errors.approver_email = 'Someone else needs to approve your request.';
      if (Object.keys(errors).length) {
        return json({ error: 'A few answers are missing or need a look.', errors }, 422);
      }
      const refs = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM files WHERE request_id = ? AND kind = 'reference' AND deleted_at IS NULL",
      )
        .bind(r.id)
        .first<{ n: number }>();
      const score = briefScore(type, brief, { refs: refs?.n || 0, title: r.title, dueDate: r.due_date || '' }).score;
      Object.assign(updates, {
        brief: JSON.stringify(cleanBrief(type, brief)),
        brief_score: score,
        is_rush: rush ? 1 : 0,
        submitted_at: r.submitted_at && action === 'submit' ? r.submitted_at : ts,
        decided_at: null,
      });
      detail.brief_score = score;
      if (rush) detail.rush = true;
      if (!needsApproval) {
        to = 'approved';
        Object.assign(updates, { approved_at: ts, decided_at: ts });
        detail.auto_approved = settings.requiresApproval ? 'lead' : 'type';
        after.push(() => routeApproved(env, ctx, me, { ...r, ...updates } as Req, settings.defaultAssignee, rq));
      } else {
        const lines = briefLines(type, brief);
        after.push(() =>
          notify(env, ctx, [r.approver_email], {
            kind: 'approval_requested',
            actor: me.email,
            request: rq,
            actionNeeded: true,
            subject: `Approval needed: ${r.title} (${r.ref})`,
            text: `${myName} needs your approval for a marketing request${rush ? ', marked rush' : ''}.`,
            cta: 'Review and approve',
            detail: [
              { label: 'Requested by', value: myName },
              { label: 'Needed by', value: r.due_date || '' },
              ...(rush ? [{ label: 'Why rush', value: r.rush_reason || '' }] : []),
              ...lines.slice(0, 4),
            ],
          }),
        );
      }
      break;
    }

    case 'approve': {
      Object.assign(updates, { approved_at: ts, decided_at: ts });
      if (r.approver_email !== me.email) detail.on_behalf_of = r.approver_email;
      after.push(() =>
        notify(env, ctx, [r.requester_email], {
          kind: 'approved',
          actor: me.email,
          request: rq,
          text: `${myName} approved your request. It’s now with the marketing team.`,
          quote: note || undefined,
        }),
      );
      after.push(() => routeApproved(env, ctx, me, { ...r, ...updates } as Req, settings.defaultAssignee, rq));
      break;
    }

    case 'reject':
      Object.assign(updates, { decided_at: ts });
      after.push(() =>
        notify(env, ctx, [r.requester_email], {
          kind: 'rejected',
          actor: me.email,
          request: rq,
          actionNeeded: true,
          text: `${myName} didn’t approve this request yet. Revise and resubmit, or cancel it.`,
          quote: note,
          cta: 'Revise the request',
        }),
      );
      break;

    case 'assign': {
      const a = String(b.assignee || '')
        .trim()
        .toLowerCase();
      if (!isEmail(a) || !allowedDomain(env, a)) fail(400, 'Choose someone from the marketing team.');
      const target = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(a).first<{ role: string }>();
      const ownerList = (env.OWNER_EMAILS || '')
        .toLowerCase()
        .split(',')
        .map((s) => s.trim());
      if (!ownerList.includes(a) && (!target || target.role === 'requester'))
        fail(400, 'Only people on the marketing team can be assigned.');
      if (a !== me.email && !isLead(me)) fail(403, 'Only marketing leads can assign work to someone else. You can take it yourself.');
      if (a === r.assignee_email) return get(env, me, r.ref);
      Object.assign(updates, { assignee_email: a, assigned_at: ts });
      detail.assignee = a;
      if (r.assignee_email) detail.previous = r.assignee_email;
      if (a !== me.email)
        after.push(() =>
          notify(env, ctx, [a], {
            kind: 'assigned',
            actor: me.email,
            request: rq,
            actionNeeded: true,
            subject: `New work for you: ${r.title} (${r.ref})`,
            text: `${myName} assigned you a ${type?.name.toLowerCase() || 'marketing'} request. It’s due ${r.due_date || 'with no date set'}.`,
            detail: [
              { label: 'Requested by', value: r.requester_email },
              { label: 'Due', value: r.due_date || '' },
              { label: 'Priority', value: r.priority },
            ],
            cta: 'Open the brief',
          }),
        );
      after.push(() =>
        notify(env, ctx, [r.requester_email], {
          kind: 'assigned_info',
          actor: me.email,
          request: rq,
          text: `${a === me.email ? myName : who(a)} is now working on your request.`,
        }),
      );
      break;
    }

    case 'start':
      Object.assign(updates, { started_at: r.started_at || ts });
      if (!r.assignee_email) Object.assign(updates, { assignee_email: me.email, assigned_at: ts });
      after.push(() =>
        notify(env, ctx, [r.requester_email], {
          kind: 'started',
          actor: me.email,
          request: rq,
          text: `${myName} started work on your request.`,
        }),
      );
      break;

    case 'deliver': {
      const deliverables = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM files WHERE request_id = ? AND kind = 'deliverable' AND version = ? AND deleted_at IS NULL",
      )
        .bind(r.id, r.revision_count + 1)
        .first<{ n: number }>();
      const links = parse<any[]>(r.links, []);
      if (!deliverables?.n && !links.length)
        fail(400, 'Attach the work (files) or add a link, such as the ad library, before sending it for review.');
      Object.assign(updates, { first_delivery_at: r.first_delivery_at || ts });
      detail.round = r.revision_count + 1;
      detail.files = deliverables?.n || 0;
      const adLink = links.find((l) => /ads\.overyondrdev\.com/.test(l.url));
      after.push(async () =>
        notify(env, ctx, [r.requester_email, ...(await participants(env, r)).filter((e) => e !== r.assignee_email)], {
          kind: 'delivered',
          actor: me.email,
          request: rq,
          actionNeeded: true,
          subject: `Ready for your review: ${r.title} (${r.ref})`,
          text: adLink
            ? `${myName} sent the ads for your review. Review them in the ad library, then accept or request changes here.`
            : `${myName} sent ${r.revision_count ? `round ${r.revision_count + 1} of ` : ''}the work for your review. Accept it, or ask for changes.`,
          quote: note,
          cta: 'Review the work',
        }),
      );
      break;
    }

    case 'request_changes':
      Object.assign(updates, { revision_count: r.revision_count + 1 });
      detail.round = r.revision_count + 1;
      after.push(() =>
        notify(env, ctx, [r.assignee_email || null, ...(r.assignee_email ? [] : [])], {
          kind: 'changes_requested',
          actor: me.email,
          request: rq,
          actionNeeded: true,
          text: `${myName} asked for changes (round ${r.revision_count + 2}).`,
          quote: note,
          cta: 'See the changes',
        }),
      );
      if (!r.assignee_email)
        after.push(async () =>
          notify(env, ctx, await leads(env), {
            kind: 'changes_requested',
            actor: me.email,
            request: rq,
            actionNeeded: true,
            text: `${myName} asked for changes on an unassigned request.`,
            quote: note,
          }),
        );
      break;

    case 'accept':
    case 'complete': {
      Object.assign(updates, { completed_at: ts, closed_at: ts });
      const rating = Number(b.rating);
      if (action === 'accept' && rating >= 1 && rating <= 5) {
        Object.assign(updates, { rating: Math.round(rating), rating_comment: str(b.rating_comment, 2000) || null });
        detail.rating = Math.round(rating);
      }
      after.push(async () =>
        notify(
          env,
          ctx,
          action === 'accept' ? [r.assignee_email, ...(await participants(env, r))] : [r.requester_email, ...(await participants(env, r))],
          {
            kind: 'completed',
            actor: me.email,
            request: rq,
            text: action === 'accept' ? `${myName} accepted the work. Request closed.` : `${myName} marked this request delivered.`,
            quote: note || undefined,
            cta: action === 'complete' ? 'View and rate it' : undefined,
          },
        ),
      );
      break;
    }

    case 'hold':
      Object.assign(updates, { prior_status: r.status });
      after.push(() =>
        notify(env, ctx, [r.requester_email], {
          kind: 'on_hold',
          actor: me.email,
          request: rq,
          text: `${myName} put your request on hold.`,
          quote: note,
        }),
      );
      break;

    case 'resume':
      Object.assign(updates, { prior_status: null });
      after.push(() =>
        notify(env, ctx, [r.requester_email], {
          kind: 'resumed',
          actor: me.email,
          request: rq,
          text: `${myName} resumed work on your request.`,
        }),
      );
      break;

    case 'cancel':
      Object.assign(updates, { closed_at: ts, awaiting_email: null });
      after.push(async () =>
        notify(env, ctx, await participants(env, r), {
          kind: 'cancelled',
          actor: me.email,
          request: rq,
          text: `${myName} cancelled this request.`,
          quote: note,
        }),
      );
      break;

    case 'reopen':
      Object.assign(updates, { completed_at: null, closed_at: null, revision_count: r.revision_count + 1 });
      after.push(async () =>
        notify(env, ctx, await participants(env, r), {
          kind: 'reopened',
          actor: me.email,
          request: rq,
          actionNeeded: true,
          text: `${myName} reopened this request.`,
          quote: note,
        }),
      );
      break;

    case 'rate': {
      const rating = Number(b.rating);
      if (!(rating >= 1 && rating <= 5)) fail(400, 'Choose 1 to 5 stars.');
      Object.assign(updates, { rating: Math.round(rating), rating_comment: str(b.rating_comment, 2000) || null });
      detail.rating = Math.round(rating);
      if (r.assignee_email)
        after.push(() =>
          notify(env, ctx, [r.assignee_email], {
            kind: 'rated',
            actor: me.email,
            request: rq,
            text: `${myName} rated your work ${Math.round(rating)}/5.`,
            quote: str(b.rating_comment, 2000) || undefined,
          }),
        );
      break;
    }
  }

  if (to !== r.status) updates.status = to;
  const cols = Object.keys(updates);
  // Optimistic concurrency: only apply if the status hasn't changed since we read it.
  const res = await env.DB.prepare(`UPDATE requests SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND status = ?`)
    .bind(...cols.map((c) => updates[c]), r.id, r.status)
    .run();
  if (!res.meta.changes) fail(409, 'Someone else just updated this request. Refresh to see the latest.');
  await logEvent(env, r, me.email, action, r.status, to, detail);
  if (note && !['submit', 'resubmit'].includes(action))
    await env.DB.prepare("INSERT INTO comments (request_id, author_email, kind, body, created_at) VALUES (?, ?, 'system', ?, ?)")
      .bind(r.id, me.email, `${def.label}: ${note}`, ts)
      .run();
  await touchFirstResponse(env, me, r);
  for (const f of after) await f();
  return get(env, me, r.ref);
}

/** After approval: route to the type's default assignee, or to the queue for leads to triage. */
async function routeApproved(env: Env, ctx: ExecutionContext, me: Me, r: Req, defaultAssignee: string | null, rq: Note['request']) {
  const type = TYPE_BY_ID[r.type_id];
  const lines = [
    { label: 'Requested by', value: r.requester_email },
    { label: 'Due', value: r.due_date || '' },
    { label: 'Priority', value: r.priority + (r.is_rush ? ' · rush' : '') },
  ];
  if (defaultAssignee && !r.assignee_email) {
    await env.DB.prepare('UPDATE requests SET assignee_email = ?, assigned_at = ? WHERE id = ? AND assignee_email IS NULL')
      .bind(defaultAssignee, now(), r.id)
      .run();
    await logEvent(env, r, 'system', 'assign', 'approved', 'approved', { assignee: defaultAssignee, auto: true });
    await notify(env, ctx, [defaultAssignee], {
      kind: 'assigned',
      actor: me.email,
      request: rq,
      actionNeeded: true,
      slack: true,
      subject: `New approved work: ${r.title} (${r.ref})`,
      text: `An approved ${type?.name.toLowerCase() || 'marketing'} request is ready for you to create.`,
      detail: lines,
      cta: 'Open the brief',
    });
  } else if (!r.assignee_email) {
    await notify(env, ctx, await leads(env), {
      kind: 'queued',
      actor: me.email,
      request: rq,
      actionNeeded: true,
      slack: true,
      subject: `New approved request to assign: ${r.title} (${r.ref})`,
      text: `An approved ${type?.name.toLowerCase() || 'marketing'} request is in the queue and needs an owner.`,
      detail: lines,
      cta: 'Assign it',
    });
  } else {
    await notify(env, ctx, [r.assignee_email], {
      kind: 'assigned',
      actor: me.email,
      request: rq,
      actionNeeded: true,
      text: `An approved request assigned to you is ready to start.`,
      detail: lines,
      cta: 'Open the brief',
    });
  }
}

function briefLines(type: any, brief: Record<string, unknown>) {
  return visibleFields(type, brief)
    .filter((f: any) => f.required)
    .map((f: any) => ({ label: f.label.replace(/\?$/, ''), value: formatAnswer(f, brief[f.id]) }))
    .filter((l: any) => l.value);
}

// ------------------------------------------------------------------ watchers
export async function watch(env: Env, me: Me, ref: string, request: Request) {
  const r = await loadVisible(env, me, ref);
  const b = request.method === 'DELETE' ? {} : await body(request);
  const email = String(b.email || me.email)
    .trim()
    .toLowerCase();
  if (email !== me.email && !(r.requester_email === me.email || isMarketing(me)))
    fail(403, 'Only the requester and the marketing team can add other people.');
  if (!isEmail(email) || !allowedDomain(env, email)) fail(400, 'Add a Yondr email address.');
  if (request.method === 'DELETE') {
    const target = new URL(request.url).searchParams.get('email')?.toLowerCase() || me.email;
    if (target !== me.email && !(r.requester_email === me.email || isMarketing(me))) fail(403, 'You can only stop watching yourself.');
    await env.DB.prepare('DELETE FROM watchers WHERE request_id = ? AND email = ?').bind(r.id, target).run();
  } else {
    await ensureUser(env, email, me.email);
    await env.DB.prepare('INSERT OR IGNORE INTO watchers (request_id, email, added_by, created_at) VALUES (?, ?, ?, ?)')
      .bind(r.id, email, me.email, now())
      .run();
    if (email !== me.email && r.status !== 'draft')
      await notify(env, undefined, [email], {
        kind: 'watching',
        actor: me.email,
        request: { id: r.id, ref: r.ref, title: r.title },
        text: `${me.name || me.email} added you to follow this marketing request.`,
      });
  }
  return get(env, me, r.ref);
}

export { isWatcher, load };
