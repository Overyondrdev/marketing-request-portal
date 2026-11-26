// Scheduled reminders (wrangler.jsonc triggers): nudges so nothing waits silently. Each reminder is sent at most
// once a day per request (the reminders table), and only on weekdays.
//   - Approvals waiting 2+ business days → the approver (and, after 4, marketing leads)
//   - Blocking questions unanswered 2+ business days → the person asked
//   - Work ready for review 3+ business days → the requester
//   - Due in 2 business days and still in production → the assignee
//   - Overdue → the assignee (or leads if unassigned), daily

import { addBusinessDays, businessDaysBetween } from '../public/js/shared/catalog.js';
import { today } from './lib/http';
import { notify } from './lib/notify';
import { leads } from './lib/users';

export async function reminders(env: Env, ctx: ExecutionContext) {
  const day = today();
  const { results } = await env.DB.prepare(
    `SELECT id, ref, title, status, requester_email, approver_email, assignee_email, awaiting_email, due_date, submitted_at, updated_at,
       (SELECT MAX(created_at) FROM events e WHERE e.request_id = requests.id AND e.to_status = requests.status) AS status_since
     FROM requests WHERE status IN ('pending_approval','needs_info','approved','in_progress','in_review')`,
  ).all<any>();
  const leadList = await leads(env);
  let sent = 0;

  for (const r of results) {
    const since = (r.status_since || r.updated_at || r.submitted_at || '').slice(0, 10);
    const waited = since ? businessDaysBetween(since, day) : 0;
    const rq = { id: r.id, ref: r.ref, title: r.title };
    const once = async (kind: string) =>
      (await env.DB.prepare('INSERT OR IGNORE INTO reminders (request_id, kind, day) VALUES (?, ?, ?)').bind(r.id, kind, day).run()).meta
        .changes > 0;

    if (r.status === 'pending_approval' && waited >= 2 && (await once('approval'))) {
      await notify(env, ctx, [r.approver_email, ...(waited >= 4 ? leadList : [])], {
        kind: 'reminder',
        actor: 'system',
        request: rq,
        actionNeeded: true,
        subject: `Reminder: approval needed for ${r.title} (${r.ref})`,
        text: `This request has been waiting ${waited} business days for approval.`,
        cta: 'Review and approve',
      });
      sent++;
    }
    if (r.status === 'needs_info' && waited >= 2 && (await once('question'))) {
      await notify(env, ctx, [r.awaiting_email || r.requester_email], {
        kind: 'reminder',
        actor: 'system',
        request: rq,
        actionNeeded: true,
        subject: `Reminder: marketing is waiting on your answer (${r.ref})`,
        text: `Work on this request is paused until you answer a question (${waited} business days so far).`,
        cta: 'Answer the question',
      });
      sent++;
    }
    if (r.status === 'in_review' && waited >= 3 && (await once('review'))) {
      await notify(env, ctx, [r.requester_email], {
        kind: 'reminder',
        actor: 'system',
        request: rq,
        actionNeeded: true,
        subject: `Reminder: your marketing request is ready for review (${r.ref})`,
        text: `The work has been ready for your review for ${waited} business days. Accept it, or ask for changes.`,
        cta: 'Review the work',
      });
      sent++;
    }
    if (['approved', 'in_progress'].includes(r.status) && r.due_date) {
      if (r.due_date < day && (await once('overdue'))) {
        await notify(env, ctx, r.assignee_email ? [r.assignee_email] : leadList, {
          kind: 'overdue',
          actor: 'system',
          request: rq,
          actionNeeded: true,
          slack: true,
          text: `This request was due ${r.due_date} and isn’t delivered yet. Update the due date or let the requester know.`,
        });
        sent++;
      } else if (r.due_date >= day && r.due_date <= addBusinessDays(day, 2) && (await once('due_soon'))) {
        await notify(env, ctx, r.assignee_email ? [r.assignee_email] : leadList, {
          kind: 'due_soon',
          actor: 'system',
          request: rq,
          actionNeeded: true,
          text: `This request is due ${r.due_date}.`,
        });
        sent++;
      }
    }
  }
  // Keep the reminders table small.
  await env.DB.prepare('DELETE FROM reminders WHERE day < ?')
    .bind(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
    .run();
  console.log(`reminders: ${sent} sent for ${results.length} open requests`);
}
