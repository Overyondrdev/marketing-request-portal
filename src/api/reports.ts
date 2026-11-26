// Reports for the marketing team: volume, speed, quality and workload. Requests are few enough (hundreds to a few
// thousand a year) to compute in the Worker from one query, which keeps the numbers easy to check.
// Range filters on when a request was submitted. "Now" figures (open, overdue, aging) ignore the range.

import { CATEGORIES, TYPE_BY_ID, formatAnswer, visibleFields } from '../../public/js/shared/catalog.js';
import { STATUSES } from '../../public/js/shared/workflow.js';
import { fail, json, parse, today, ymd } from '../lib/http';
import { isOverdue } from '../lib/requests';
import { isLead, isMarketing, namesFor, type Me } from '../lib/users';

const DAY = 864e5;
const hours = (a?: string | null, b?: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 3600e3 : null);
function median(xs: (number | null)[]) {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const medianDays = (xs: (number | null)[]) => {
  const h = median(xs);
  return h === null ? null : Math.round((h / 24) * 10) / 10;
};
const round = (x: number | null, d = 1) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
// Delivered by the first date the assignee estimated (null when there was no estimate).
const metEstimate = (r: any) => (r.completed_at && r.first_estimate_date ? r.completed_at.slice(0, 10) <= r.first_estimate_date : null);
const onTime = (r: any) => (r.completed_at && r.due_date ? r.completed_at.slice(0, 10) <= r.due_date : null);
function weekStart(iso: string) {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function range(url: URL) {
  const to = ymd(url.searchParams.get('to')) || today();
  const from = ymd(url.searchParams.get('from')) || new Date(Date.parse(to) - 89 * DAY).toISOString().slice(0, 10);
  if (from > to) fail(400, 'The start date is after the end date.');
  return { from, to };
}

function stats(rows: any[]) {
  const done = rows.filter((r) => r.status === 'completed');
  const dated = done.filter((r) => r.due_date);
  return {
    count: rows.length,
    completed: done.length,
    on_time_pct: pct(dated.filter((r) => onTime(r)).length, dated.length),
    median_cycle_days: medianDays(done.map((r) => hours(r.submitted_at, r.completed_at))),
    avg_rating: round(avg(done.map((r) => r.rating)), 2),
  };
}

export async function report(env: Env, me: Me, url: URL) {
  if (!isMarketing(me)) fail(403, 'Reports are for the marketing team.');
  const { from, to } = range(url);
  const { results: all } = await env.DB.prepare(
    `SELECT id, ref, type_id, category_id, title, status, priority, requester_email, approver_email, assignee_email,
            department, due_date, estimated_date, first_estimate_date, brief_score, revision_count, rating, created_at, submitted_at, decided_at, approved_at,
            assigned_at, started_at, first_response_at, first_delivery_at, completed_at, closed_at
     FROM requests WHERE status <> 'draft'`,
  ).all<any>();

  const inRange = all.filter((r) => r.submitted_at && r.submitted_at.slice(0, 10) >= from && r.submitted_at.slice(0, 10) <= to);
  const completedInRange = all.filter((r) => r.completed_at && r.completed_at.slice(0, 10) >= from && r.completed_at.slice(0, 10) <= to);
  const decided = inRange.filter((r) => r.decided_at);
  const approved = inRange.filter((r) => r.approved_at);
  const rejectedEver =
    (
      await env.DB.prepare(
        "SELECT COUNT(DISTINCT request_id) AS n FROM events WHERE action = 'reject' AND created_at >= ? AND created_at <= ?",
      )
        .bind(from, to + 'T99')
        .first<{ n: number }>()
    )?.n || 0;
  const dated = completedInRange.filter((r) => r.due_date);

  const kpis = {
    submitted: inRange.length,
    approved: approved.length,
    declined_once: rejectedEver,
    completed: completedInRange.length,
    cancelled: inRange.filter((r) => r.status === 'cancelled').length,
    approval_rate_pct: pct(approved.length, decided.length),
    median_approval_hours: round(median(decided.map((r) => hours(r.submitted_at, r.decided_at)))),
    median_first_response_hours: round(median(approved.map((r) => hours(r.approved_at, r.first_response_at || r.started_at)))),
    median_turnaround_days: medianDays(completedInRange.map((r) => hours(r.approved_at, r.completed_at))),
    median_cycle_days: medianDays(completedInRange.map((r) => hours(r.submitted_at, r.completed_at))),
    on_time_pct: pct(dated.filter((r) => onTime(r)).length, dated.length),
    first_time_right_pct: pct(completedInRange.filter((r) => !r.revision_count).length, completedInRange.length),
    avg_revisions: round(avg(completedInRange.map((r) => r.revision_count)), 2),
    avg_rating: round(avg(completedInRange.map((r) => r.rating)), 2),
    ratings: completedInRange.filter((r) => r.rating).length,
    avg_brief_score: round(avg(inRange.map((r) => r.brief_score)), 0),
    estimate_hit_pct: pct(
      completedInRange.filter((r) => metEstimate(r)).length,
      completedInRange.filter((r) => metEstimate(r) !== null).length,
    ),
    estimate_slips: inRange.filter((r) => r.first_estimate_date && r.estimated_date && r.estimated_date > r.first_estimate_date).length,
  };

  // Now: open work, regardless of range.
  const open = all.filter((r) => STATUSES[r.status as keyof typeof STATUSES]?.open);
  const t = Date.now();
  const age = (r: any) => (t - Date.parse(r.submitted_at || r.created_at)) / DAY;
  const now = {
    by_status: Object.fromEntries(
      Object.keys(STATUSES)
        .filter((s) => s !== 'draft')
        .map((s) => [s, all.filter((r) => r.status === s).length]),
    ),
    open: open.length,
    overdue: open.filter(isOverdue).length,
    unassigned: open.filter((r) => r.status === 'approved' && !r.assignee_email).length,
    aging: [
      { label: 'Under a week', n: open.filter((r) => age(r) < 7).length },
      { label: '1–2 weeks', n: open.filter((r) => age(r) >= 7 && age(r) < 14).length },
      { label: '2–4 weeks', n: open.filter((r) => age(r) >= 14 && age(r) < 28).length },
      { label: '4+ weeks', n: open.filter((r) => age(r) >= 28).length },
    ],
    overdue_list: open
      .filter(isOverdue)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 25)
      .map((r) => ({
        ref: r.ref,
        title: r.title,
        status: r.status,
        due_date: r.due_date,
        assignee_email: r.assignee_email,
        type_id: r.type_id,
      })),
  };

  // Trend by week (Monday), across the range.
  const weeks: Record<string, { week: string; submitted: number; completed: number }> = {};
  for (let d = Date.parse(weekStart(from)); d <= Date.parse(to); d += 7 * DAY) {
    const w = new Date(d).toISOString().slice(0, 10);
    weeks[w] = { week: w, submitted: 0, completed: 0 };
  }
  for (const r of inRange) weeks[weekStart(r.submitted_at)] && weeks[weekStart(r.submitted_at)].submitted++;
  for (const r of completedInRange) weeks[weekStart(r.completed_at)] && weeks[weekStart(r.completed_at)].completed++;

  const group = (key: (r: any) => string | null) => {
    const m = new Map<string, any[]>();
    for (const r of inRange) {
      const k = key(r) || '—';
      m.set(k, [...(m.get(k) || []), r]);
    }
    return [...m.entries()].map(([k, rows]) => ({ key: k, ...stats(rows) })).sort((a, b) => b.count - a.count);
  };

  const by_type = group((r) => r.type_id).map((g) => ({ ...g, label: TYPE_BY_ID[g.key]?.name || g.key }));
  const by_category = group((r) => r.category_id).map((g) => ({ ...g, label: CATEGORIES.find((c) => c.id === g.key)?.name || g.key }));
  const by_department = group((r) => r.department);
  const by_requester = group((r) => r.requester_email).slice(0, 15);

  // Workload by person: leads see everyone, the rest of the team see only their own line.
  const people = new Set(all.map((r) => r.assignee_email).filter(Boolean));
  let by_assignee = [...people]
    .map((email) => {
      const mine = all.filter((r) => r.assignee_email === email);
      const doneIn = completedInRange.filter((r) => r.assignee_email === email);
      const datedIn = doneIn.filter((r) => r.due_date);
      return {
        key: email,
        open: mine.filter((r) => ['approved', 'in_progress', 'on_hold', 'needs_info'].includes(r.status)).length,
        in_review: mine.filter((r) => r.status === 'in_review').length,
        overdue: mine.filter(isOverdue).length,
        completed: doneIn.length,
        on_time_pct: pct(datedIn.filter((r) => onTime(r)).length, datedIn.length),
        median_turnaround_days: medianDays(doneIn.map((r) => hours(r.approved_at, r.completed_at))),
        estimate_hit_pct: pct(doneIn.filter((r) => metEstimate(r)).length, doneIn.filter((r) => metEstimate(r) !== null).length),
        avg_rating: round(avg(doneIn.map((r) => r.rating)), 2),
      };
    })
    .sort((a, b) => b.open - a.open || b.completed - a.completed);
  if (!isLead(me)) by_assignee = by_assignee.filter((a) => a.key === me.email);

  const names = await namesFor(env, [
    ...by_assignee.map((a) => a.key),
    ...by_requester.map((r) => r.key),
    ...now.overdue_list.map((r) => r.assignee_email),
  ]);
  return json({
    range: { from, to },
    kpis,
    now,
    trend: Object.values(weeks),
    by_type,
    by_category,
    by_department,
    by_requester,
    by_assignee,
    names,
    lead: isLead(me),
  });
}

/** Every request in the range as CSV, with its brief flattened, for spreadsheets. */
export async function exportCsv(env: Env, me: Me, url: URL) {
  if (!isMarketing(me)) fail(403, 'Exports are for the marketing team.');
  const { from, to } = range(url);
  const { results } = await env.DB.prepare(
    "SELECT * FROM requests WHERE status <> 'draft' AND submitted_at >= ? AND submitted_at <= ? ORDER BY id",
  )
    .bind(from, to + 'T99')
    .all<any>();
  const cols = [
    'ref',
    'title',
    'type',
    'category',
    'status',
    'priority',
    'estimated_delivery',
    'requester',
    'department',
    'approver',
    'assignee',
    'due_date',
    'submitted_at',
    'approved_at',
    'first_delivery_at',
    'completed_at',
    'on_time',
    'revisions',
    'rating',
    'brief_score',
    'objective',
    'audience',
    'brief',
  ];
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // no formula injection in spreadsheets
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of results) {
    const type = TYPE_BY_ID[r.type_id];
    const brief = parse<Record<string, unknown>>(r.brief, {});
    const flat = type
      ? visibleFields(type, brief)
          .filter((f: any) => !['objective', 'audience'].includes(f.id) && brief[f.id] !== undefined)
          .map((f: any) => `${f.label}: ${formatAnswer(f, brief[f.id]).replace(/\n/g, ' / ')}`)
          .join(' | ')
      : '';
    lines.push(
      [
        r.ref,
        r.title,
        type?.name || r.type_id,
        CATEGORIES.find((c) => c.id === r.category_id)?.name || r.category_id,
        STATUSES[r.status as keyof typeof STATUSES]?.label || r.status,
        r.priority,
        r.estimated_date,
        r.requester_email,
        r.department,
        r.approver_email,
        r.assignee_email,
        r.due_date,
        r.submitted_at,
        r.approved_at,
        r.first_delivery_at,
        r.completed_at,
        onTime(r) === null ? '' : onTime(r) ? 'yes' : 'no',
        r.revision_count,
        r.rating,
        r.brief_score,
        brief.objective,
        Array.isArray(brief.audience) ? brief.audience.join('; ') : '',
        flat,
      ]
        .map(cell)
        .join(','),
    );
  }
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="marketing-requests-${from}-to-${to}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
