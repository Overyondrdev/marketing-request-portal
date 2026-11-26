// The request lifecycle: statuses, the stages people see, and who may do what. Shared by the browser (which buttons
// to show) and the Worker (which enforces every rule; the browser only hides what you can't do).
//
//   draft ─submit→ pending_approval ─approve→ approved ─start→ in_progress ─deliver→ in_review ─accept→ completed
//                        │  └reject→ rejected ─resubmit┘            │  ↑                  └request_changes┘
//                        └─ any blocking question → needs_info → (answered) → back where it was
//   on_hold ⇄ approved / in_progress; cancel from any open status; reopen a completed request.

export const STATUSES = {
  draft: { label: 'Draft', tone: 'muted', open: true },
  pending_approval: { label: 'Awaiting approval', tone: 'wait', open: true },
  needs_info: { label: 'Question for requester', tone: 'warn', open: true },
  rejected: { label: 'Not approved', tone: 'bad', open: true },
  approved: { label: 'In marketing queue', tone: 'info', open: true },
  in_progress: { label: 'In production', tone: 'go', open: true },
  in_review: { label: 'In review', tone: 'review', open: true },
  on_hold: { label: 'On hold', tone: 'muted', open: true },
  completed: { label: 'Delivered', tone: 'done', open: false },
  cancelled: { label: 'Cancelled', tone: 'muted', open: false },
};
export const OPEN_STATUSES = Object.keys(STATUSES).filter((s) => STATUSES[s].open && s !== 'draft');

// The progress bar every party sees.
export const STAGES = [
  { id: 'brief', label: 'Brief' },
  { id: 'approval', label: 'Manager approval' },
  { id: 'queue', label: 'Marketing queue' },
  { id: 'production', label: 'In production' },
  { id: 'review', label: 'Your review' },
  { id: 'done', label: 'Delivered' },
];
const STAGE_OF = {
  draft: 'brief',
  pending_approval: 'approval',
  rejected: 'approval',
  approved: 'queue',
  in_progress: 'production',
  on_hold: 'production',
  in_review: 'review',
  completed: 'done',
  cancelled: 'brief',
};
export function stageOf(req) {
  const s = req.status === 'needs_info' || req.status === 'on_hold' ? req.prior_status || 'pending_approval' : req.status;
  return STAGE_OF[s] || 'brief';
}

export const ROLES = ['requester', 'marketing', 'lead', 'admin'];
export const ROLE_LABELS = { requester: 'Requester', marketing: 'Marketing team', lead: 'Marketing lead', admin: 'Admin' };
const RANK = { requester: 0, marketing: 1, lead: 2, admin: 3 };
export const atLeast = (role, needed) => (RANK[role] ?? -1) >= RANK[needed];

/**
 * How a person relates to a request.
 * @param {{ email: string, role: string }} me
 * @param {any} req
 */
export function relation(me, req) {
  return {
    requester: req.requester_email === me.email,
    approver: req.approver_email === me.email,
    assignee: req.assignee_email === me.email,
    marketing: atLeast(me.role, 'marketing'),
    lead: atLeast(me.role, 'lead'),
  };
}

// Actions on a request. `from`: statuses it applies to; `who`: which relations may take it; `to`: the new status
// (null = unchanged; 'prior' = return to prior_status). `needs`: inputs the action requires.
export const ACTIONS = {
  submit: { label: 'Submit request', from: ['draft'], who: ['requester'], to: 'pending_approval' },
  resubmit: { label: 'Resubmit for approval', from: ['rejected'], who: ['requester'], to: 'pending_approval' },
  approve: { label: 'Approve', from: ['pending_approval'], who: ['approver', 'lead'], to: 'approved' },
  reject: { label: 'Decline', from: ['pending_approval'], who: ['approver', 'lead'], to: 'rejected', needs: ['note'] },
  assign: {
    label: 'Assign',
    from: ['approved', 'in_progress', 'in_review', 'on_hold', 'needs_info'],
    who: ['lead', 'marketing'],
    to: null,
    needs: ['assignee'],
  },
  // Starting work means estimating when it will be ready; the estimate can be updated any time after.
  start: { label: 'Start work', from: ['approved'], who: ['marketing'], to: 'in_progress', needs: ['estimate'] },
  estimate: {
    label: 'Update estimate',
    from: ['approved', 'in_progress', 'on_hold', 'needs_info', 'in_review'],
    who: ['assignee', 'lead'],
    to: null,
    needs: ['estimate'],
  },
  deliver: { label: 'Send for review', from: ['in_progress'], who: ['assignee', 'marketing'], to: 'in_review', needs: ['note'] },
  request_changes: { label: 'Request changes', from: ['in_review'], who: ['requester', 'approver'], to: 'in_progress', needs: ['note'] },
  accept: { label: 'Accept and close', from: ['in_review'], who: ['requester'], to: 'completed' },
  complete: { label: 'Mark delivered', from: ['in_review', 'in_progress'], who: ['assignee', 'lead'], to: 'completed' },
  hold: { label: 'Put on hold', from: ['approved', 'in_progress'], who: ['assignee', 'lead'], to: 'on_hold', needs: ['note'] },
  resume: { label: 'Resume', from: ['on_hold'], who: ['assignee', 'lead'], to: 'prior' },
  cancel: {
    label: 'Cancel request',
    from: ['draft', 'pending_approval', 'needs_info', 'rejected', 'approved', 'in_progress', 'in_review', 'on_hold'],
    who: ['requester', 'lead'],
    to: 'cancelled',
    needs: ['note'],
  },
  reopen: { label: 'Reopen', from: ['completed'], who: ['requester', 'assignee', 'lead'], to: 'in_progress', needs: ['note'] },
  rate: { label: 'Rate this request', from: ['completed'], who: ['requester'], to: null },
};

/** Can this person take this action on this request now? */
export function can(me, req, action) {
  const a = ACTIONS[action];
  if (!a || !a.from.includes(req.status)) return false;
  const rel = relation(me, req);
  // Nobody approves their own request, even a lead.
  if ((action === 'approve' || action === 'reject') && rel.requester && !atLeast(me.role, 'admin')) return false;
  return a.who.some((w) => rel[w]);
}

/** Every action this person can take now, in display order. */
export function availableActions(me, req) {
  return Object.keys(ACTIONS).filter((a) => can(me, req, a));
}

/** Who the request is waiting on right now: an email, 'marketing' (the queue), or null when closed. */
export function waitingOn(req) {
  switch (req.status) {
    case 'draft':
    case 'rejected':
    case 'in_review':
      return req.requester_email;
    case 'pending_approval':
      return req.approver_email;
    case 'needs_info':
      return req.awaiting_email || req.requester_email;
    case 'approved':
      return req.assignee_email || 'marketing';
    case 'in_progress':
    case 'on_hold':
      return req.assignee_email || 'marketing';
    default:
      return null;
  }
}

/** Can this person edit the brief? Requesters until work starts; marketing while it's open. */
export function canEditBrief(me, req) {
  const rel = relation(me, req);
  if (rel.requester && ['draft', 'pending_approval', 'needs_info', 'rejected'].includes(req.status)) return true;
  return rel.marketing && STATUSES[req.status]?.open && req.status !== 'draft';
}

/** Can this person see the request at all? */
export function canView(me, req, isWatcher = false) {
  const rel = relation(me, req);
  if (req.status === 'draft') return rel.requester;
  return rel.requester || rel.approver || rel.assignee || rel.marketing || isWatcher;
}
