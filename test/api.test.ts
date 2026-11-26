// The API end to end, inside the Workers runtime with a local D1 and R2.
import { exports } from 'cloudflare:workers';
import { describe, expect, it, beforeAll } from 'vitest';

const worker = (exports as unknown as { default: { fetch(r: Request): Promise<Response> } }).default;

const SAM = 'sam.requester@overyondr.com',
  MGR = 'morgan.manager@overyondr.com',
  DANA = 'dana.designer@overyondr.com',
  OWNER = 'alex.owner@overyondr.com',
  OTHER = 'pat.other@overyondr.com';

async function call(who: string, method: string, path: string, body?: unknown, raw?: BodyInit) {
  const res = await worker.fetch(
    new Request('https://requests.example' + path, {
      method,
      headers: {
        'x-dev-email': who,
        'x-requested-with': 'mrp',
        'content-type': raw ? 'image/png' : 'application/json',
        ...(raw ? { 'content-length': '3' } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    }),
  );
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}
const due = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  for (const e of [SAM, MGR, DANA, OWNER]) await call(e, 'GET', '/api/me');
  await call(OWNER, 'PUT', `/api/admin/people/${DANA}`, { role: 'marketing' });
  await call(OWNER, 'PUT', '/api/admin/types/presentation', { default_assignee: DANA });
});

async function submittedDeck() {
  const { request } = await call(SAM, 'POST', '/api/requests', { type_id: 'presentation' });
  await call(SAM, 'PATCH', `/api/requests/${request.ref}`, {
    title: 'District deck',
    due_date: due(30),
    approver_email: MGR,
    brief: {
      objective: 'Help sales win districts.',
      audience: ['Schools (K-12)'],
      purpose: 'sales',
      starting_point: 'new',
      file_format: 'PowerPoint',
    },
  });
  const s = await call(SAM, 'POST', `/api/requests/${request.ref}/actions/submit`, {});
  expect(s.request.status).toBe('pending_approval');
  return request.ref as string;
}

describe('access', () => {
  it('rejects people outside Yondr', async () => {
    const r = await call('eve@example.com', 'GET', '/api/me');
    expect(r.status).toBe(403);
  });
  it('rejects state changes without the CSRF header', async () => {
    const res = await worker.fetch(
      new Request('https://requests.example/api/requests', {
        method: 'POST',
        headers: { 'x-dev-email': SAM, 'content-type': 'application/json' },
        body: '{"type_id":"other"}',
      }),
    );
    expect(res.status).toBe(403);
  });
  it('sends security headers', async () => {
    const res = await worker.fetch(new Request('https://requests.example/api/me', { headers: { 'x-dev-email': SAM } }));
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('request lifecycle', () => {
  it('refuses to submit an incomplete brief, with field-level errors', async () => {
    const { request } = await call(SAM, 'POST', '/api/requests', { type_id: 'trade_show' });
    const r = await call(SAM, 'POST', `/api/requests/${request.ref}/actions/submit`, {});
    expect(r.status).toBe(422);
    expect(Object.keys(r.errors)).toEqual(expect.arrayContaining(['event_name', 'due_date', 'approver_email']));
  });

  it('requires a reason for rush dates', async () => {
    const { request } = await call(SAM, 'POST', '/api/requests', { type_id: 'presentation' });
    await call(SAM, 'PATCH', `/api/requests/${request.ref}`, {
      title: 'Rush deck',
      due_date: due(1),
      approver_email: MGR,
      brief: { objective: 'x', audience: ['Schools (K-12)'], purpose: 'sales', starting_point: 'new', file_format: 'PDF' },
    });
    const r = await call(SAM, 'POST', `/api/requests/${request.ref}/actions/submit`, {});
    expect(r.errors?.rush_reason).toBeTruthy();
  });

  it('goes from approval to delivery, with routing, questions and revisions', async () => {
    const ref = await submittedDeck();
    expect((await call(SAM, 'POST', `/api/requests/${ref}/actions/approve`, {})).status).toBe(403);
    expect((await call(OTHER, 'GET', `/api/requests/${ref}`)).status).toBe(404);

    const q = await call(MGR, 'POST', `/api/requests/${ref}/comments`, { kind: 'question', body: 'Which region?', blocking: true });
    expect(q.request.status).toBe('needs_info');
    const qid = q.comments.find((c: any) => c.kind === 'question').id;
    const a = await call(SAM, 'POST', `/api/requests/${ref}/comments`, { body: 'Texas.', parent_id: qid });
    expect(a.request.status).toBe('pending_approval');

    const ap = await call(MGR, 'POST', `/api/requests/${ref}/actions/approve`, {});
    expect(ap.request.status).toBe('approved');
    expect(ap.request.assignee_email).toBe(DANA);

    expect((await call(DANA, 'POST', `/api/requests/${ref}/actions/start`, {})).request.status).toBe('in_progress');
    expect((await call(DANA, 'POST', `/api/requests/${ref}/actions/deliver`, { note: 'v1' })).status).toBe(400);
    await call(DANA, 'PUT', `/api/requests/${ref}/files?kind=deliverable&name=v1.png`, undefined, new Uint8Array([1, 2, 3]));
    expect((await call(DANA, 'POST', `/api/requests/${ref}/actions/deliver`, { note: 'v1' })).request.status).toBe('in_review');
    const ch = await call(SAM, 'POST', `/api/requests/${ref}/actions/request_changes`, { note: 'Add a slide' });
    expect(ch.request.revision_count).toBe(1);
    await call(DANA, 'PUT', `/api/requests/${ref}/files?kind=deliverable&name=v2.png`, undefined, new Uint8Array([1, 2, 3]));
    await call(DANA, 'POST', `/api/requests/${ref}/actions/deliver`, { note: 'v2' });
    const done = await call(SAM, 'POST', `/api/requests/${ref}/actions/accept`, { rating: 5 });
    expect(done.request.status).toBe('completed');
    expect(done.request.rating).toBe(5);

    const inbox = await call(DANA, 'GET', '/api/notifications');
    expect(inbox.items.map((n: any) => n.kind)).toEqual(expect.arrayContaining(['assigned', 'changes_requested', 'completed']));
    const report = await call(OWNER, 'GET', '/api/reports');
    expect(report.kpis.completed).toBeGreaterThanOrEqual(1);
    expect((await call(SAM, 'GET', '/api/reports')).status).toBe(403);
  });

  it('hides internal notes from requesters', async () => {
    const ref = await submittedDeck();
    await call(OWNER, 'POST', `/api/requests/${ref}/comments`, { kind: 'internal', body: 'Budget is tight' });
    const asSam = await call(SAM, 'GET', `/api/requests/${ref}`);
    expect(asSam.comments.some((c: any) => c.kind === 'internal')).toBe(false);
    const asOwner = await call(OWNER, 'GET', `/api/requests/${ref}`);
    expect(asOwner.comments.some((c: any) => c.kind === 'internal')).toBe(true);
    expect((await call(SAM, 'POST', `/api/requests/${ref}/comments`, { kind: 'internal', body: 'x' })).status).toBe(403);
  });

  it('only admins change roles', async () => {
    expect((await call(DANA, 'PUT', `/api/admin/people/${SAM}`, { role: 'admin' })).status).toBe(403);
    expect((await call(OWNER, 'PUT', `/api/admin/people/${OWNER}`, { role: 'requester' })).status).toBe(400);
  });
});
