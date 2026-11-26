// The conversation on a request: comments, questions (optionally pausing work until answered) and marketing-only
// internal notes. Answering a question (replying to it as the person asked) resolves it; when the last blocking
// question is answered, the request goes back to where it was.

import { STATUSES } from '../../public/js/shared/workflow.js';
import { allowedDomain } from '../lib/access';
import { body, fail, isEmail, now, str } from '../lib/http';
import { notify } from '../lib/notify';
import { loadVisible, logEvent, participants, touchFirstResponse } from '../lib/requests';
import { isMarketing, leads, type Me } from '../lib/users';
import { get } from './requests';

const PAUSABLE = ['pending_approval', 'approved', 'in_progress', 'on_hold'];

export async function postComment(env: Env, ctx: ExecutionContext, me: Me, ref: string, request: Request) {
  const r = await loadVisible(env, me, ref);
  if (r.status === 'draft') fail(400, 'Submit the request first; then you can talk with marketing here.');
  const b = await body(request);
  const text = str(b.body, 10000);
  if (!text) fail(400, 'Write something first.');
  let kind: string = ['comment', 'question', 'internal'].includes(b.kind) ? b.kind : 'comment';
  if (kind === 'internal' && !isMarketing(me)) fail(403, 'Internal notes are for the marketing team.');
  const mk = isMarketing(me);
  const ts = now();

  // Replying to a question: if I'm the person asked, it answers (resolves) it.
  let parent: any = null;
  if (b.parent_id) {
    parent = await env.DB.prepare('SELECT * FROM comments WHERE id = ? AND request_id = ?').bind(Number(b.parent_id), r.id).first<any>();
    if (!parent) fail(400, 'That message is gone.');
    if (parent.kind === 'internal' && !mk) fail(404, 'That message is gone.');
    if (parent.kind === 'internal') kind = 'internal';
    else kind = 'comment';
  }

  let to: string | null = null;
  let blocking = 0;
  if (kind === 'question') {
    to = String(b.to_email || r.requester_email)
      .trim()
      .toLowerCase();
    if (!isEmail(to) || !allowedDomain(env, to)) fail(400, 'Ask someone with a Yondr email address.');
    if (to === me.email) fail(400, 'Ask someone other than yourself.');
    // Pausing work for an answer: approvers and marketing can, while the request is with them.
    blocking = b.blocking && PAUSABLE.includes(r.status) && (mk || r.approver_email === me.email) ? 1 : 0;
  }

  const row = await env.DB.prepare(
    `INSERT INTO comments (request_id, author_email, kind, body, to_email, blocking, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(r.id, me.email, kind, text, to, blocking, parent?.id ?? null, ts)
    .first<{ id: number }>();

  const rq = { id: r.id, ref: r.ref, title: r.title };
  const myName = me.name || me.email.split('@')[0];
  let resolvedBlocking = false;
  if (parent && parent.kind === 'question' && !parent.resolved_at && (parent.to_email === me.email || parent.author_email === me.email)) {
    await env.DB.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?').bind(ts, me.email, parent.id).run();
    resolvedBlocking = !!parent.blocking;
    await logEvent(env, r, me.email, 'answered', r.status, r.status, { question: parent.id });
  }

  // Status changes: a blocking question pauses work; answering the last one resumes it.
  if (blocking) {
    const prior = r.status;
    await env.DB.prepare(
      "UPDATE requests SET status = 'needs_info', prior_status = ?, awaiting_email = ?, updated_at = ? WHERE id = ? AND status = ?",
    )
      .bind(prior, to, ts, r.id, prior)
      .run();
    await logEvent(env, r, me.email, 'asked', prior, 'needs_info', { to, question: row!.id });
  } else if (resolvedBlocking && r.status === 'needs_info') {
    const open = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE request_id = ? AND kind = 'question' AND blocking = 1 AND resolved_at IS NULL",
    )
      .bind(r.id)
      .first<{ n: number }>();
    if (!open?.n) {
      const back = r.prior_status && r.prior_status in STATUSES ? r.prior_status : 'in_progress';
      await env.DB.prepare(
        "UPDATE requests SET status = ?, prior_status = NULL, awaiting_email = NULL, updated_at = ? WHERE id = ? AND status = 'needs_info'",
      )
        .bind(back, ts, r.id)
        .run();
      await logEvent(env, r, me.email, 'resumed', 'needs_info', back, { reason: 'answered' });
    }
  } else {
    await env.DB.prepare('UPDATE requests SET updated_at = ? WHERE id = ?').bind(ts, r.id).run();
  }
  await touchFirstResponse(env, me, r);

  // Who hears about it.
  if (kind === 'question') {
    await notify(env, ctx, [to], {
      kind: 'question',
      actor: me.email,
      request: rq,
      actionNeeded: true,
      subject: `Question about ${r.title} (${r.ref})`,
      text: blocking ? `${myName} has a question, and work is paused until you answer.` : `${myName} has a question for you.`,
      quote: text,
      cta: 'Answer the question',
    });
    const others = (await participants(env, r)).filter((e) => e !== to);
    if (others.length)
      await notify(env, ctx, others, {
        kind: 'comment',
        actor: me.email,
        request: rq,
        text: `${myName} asked ${to!.split('@')[0]} a question.`,
        quote: text,
      });
  } else if (kind === 'internal') {
    const team = (await participants(env, r)).filter((e) => e !== r.requester_email && e !== r.approver_email);
    const recipients = r.assignee_email ? team : [...team, ...(await leads(env))];
    const { results } = await env.DB.prepare(
      `SELECT email FROM users WHERE role IN ('marketing','lead','admin') AND email IN (${recipients.map(() => '?').join(',') || "''"})`,
    )
      .bind(...recipients)
      .all<{ email: string }>();
    await notify(
      env,
      ctx,
      results.map((x) => x.email),
      { kind: 'internal', actor: me.email, request: rq, text: `${myName} added an internal note.`, quote: text },
    );
  } else {
    let people = await participants(env, r);
    if (!r.assignee_email && r.approved_at) people = [...people, ...(await leads(env))];
    if (r.status === 'pending_approval' || !r.approved_at) people = people.filter((e) => e !== r.assignee_email);
    await notify(env, ctx, people, {
      kind: parent?.kind === 'question' ? 'answer' : 'comment',
      actor: me.email,
      request: rq,
      text: parent?.kind === 'question' ? `${myName} answered a question.` : `${myName} commented.`,
      quote: text,
    });
  }
  return get(env, me, r.ref);
}

/** Edit or delete your own comment (within 24 hours), or resolve a question without replying. */
export async function changeComment(env: Env, me: Me, id: number, request: Request) {
  const c = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first<any>();
  if (!c) fail(404, 'That message is gone.');
  const r = await loadVisible(env, me, String(c.request_id));
  if (c.kind === 'internal' && !isMarketing(me)) fail(404, 'That message is gone.');
  const b = request.method === 'DELETE' ? {} : await body(request);
  const mine = c.author_email === me.email;
  const fresh = Date.now() - Date.parse(c.created_at) < 24 * 3600_000;

  if (request.method === 'POST' && b.resolve) {
    if (c.kind !== 'question') fail(400, 'Only questions can be resolved.');
    if (!(mine || c.to_email === me.email || isMarketing(me))) fail(403, 'Only the person who asked or was asked can resolve it.');
    if (c.blocking && r.status === 'needs_info') fail(400, 'Reply to the question so work can carry on.');
    await env.DB.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?').bind(now(), me.email, id).run();
    return get(env, me, r.ref);
  }
  if (!mine) fail(403, 'You can only change your own messages.');
  if (!fresh) fail(400, 'Messages can only be changed for 24 hours. Add a new one instead.');
  if (c.kind === 'system') fail(400, 'This message is part of the request’s history.');
  if (request.method === 'DELETE') {
    if (c.kind === 'question' && c.blocking && !c.resolved_at) fail(400, 'Resolve the question instead of deleting it.');
    await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  } else {
    const text = str(b.body, 10000);
    if (!text) fail(400, 'Write something first.');
    await env.DB.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').bind(text, now(), id).run();
  }
  return get(env, me, r.ref);
}
