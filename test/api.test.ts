// The API end to end, inside the Workers runtime with a local D1 and R2.
import { exports } from 'cloudflare:workers';
import { describe, expect, it, beforeAll, vi } from 'vitest';

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

// Every email goes to Resend's batch endpoint; capture the calls instead of sending.
const sent: { url: string; headers: Headers; body: any[] }[] = [];
const realFetch = globalThis.fetch;
vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://api.resend.com/')) {
    sent.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return Response.json({ data: [{ id: 'test' }] });
  }
  return realFetch(input as any, init);
});

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

describe('app files', () => {
  const get = (path: string, headers: Record<string, string> = {}) =>
    worker.fetch(new Request('https://requests.example' + path, { headers: { 'x-dev-email': SAM, ...headers } }));
  it('serves the app shell for app routes, files with types, and 404 for missing files', async () => {
    for (const p of ['/', '/requests/MR-1001', '/new/presentation']) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/html');
      expect(r.headers.get('content-security-policy')).toContain("script-src 'self'");
      // The shared Yondr people picker loads from, and asks, the sign-in host.
      expect(r.headers.get('content-security-policy')).toContain("script-src 'self' https://auth.overyondrdev.com");
      expect(r.headers.get('content-security-policy')).toContain("connect-src 'self' https://auth.overyondrdev.com");
    }
    expect((await get('/css/base.css')).headers.get('content-type')).toContain('text/css');
    expect((await get('/js/app.js')).headers.get('content-type')).toContain('javascript');
    expect((await get('/brand/fonts/inter-tight-latin-400-normal.woff2')).headers.get('content-type')).toBe('font/woff2');
    expect((await get('/css/missing.css')).status).toBe(404);
    const etag = (await get('/js/app.js')).headers.get('etag')!;
    expect((await get('/js/app.js', { 'if-none-match': etag })).status).toBe(304);
  });
  it('refuses app files to people outside Yondr', async () => {
    const r = await worker.fetch(new Request('https://requests.example/js/app.js', { headers: { 'x-dev-email': 'eve@example.com' } }));
    expect(r.status).toBe(403);
  });
});

describe('request lifecycle', () => {
  it('refuses to submit an incomplete brief, with field-level errors', async () => {
    const { request } = await call(SAM, 'POST', '/api/requests', { type_id: 'trade_show' });
    const r = await call(SAM, 'POST', `/api/requests/${request.ref}/actions/submit`, {});
    expect(r.status).toBe(422);
    expect(Object.keys(r.errors)).toEqual(expect.arrayContaining(['event_name', 'due_date', 'approver_email']));
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

    expect((await call(DANA, 'POST', `/api/requests/${ref}/actions/start`, {})).status).toBe(400); // needs an estimate
    const started = await call(DANA, 'POST', `/api/requests/${ref}/actions/start`, { estimated_date: due(10) });
    expect(started.request.status).toBe('in_progress');
    expect(started.request.estimated_date).toBe(due(10));
    const moved = await call(DANA, 'POST', `/api/requests/${ref}/actions/estimate`, { estimated_date: due(12), note: 'Waiting on photos' });
    expect(moved.request.estimated_date).toBe(due(12));
    expect((await call(SAM, 'POST', `/api/requests/${ref}/actions/estimate`, { estimated_date: due(5) })).status).toBe(409);
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

  it('emails the approver through Resend, one private message each, replying to the requester', async () => {
    sent.length = 0;
    const ref = await submittedDeck();
    await new Promise((r) => setTimeout(r, 50)); // email is sent in waitUntil
    const call = sent.find((c) => c.body.some((m: any) => m.to[0].includes(MGR)));
    expect(call?.url).toBe('https://api.resend.com/emails/batch');
    expect(call?.headers.get('authorization')).toBe('Bearer re_test_key');
    expect(call?.headers.get('idempotency-key')).toBeTruthy();
    const msg = call!.body[0];
    expect(msg.to).toHaveLength(1);
    expect(msg.subject).toContain(ref);
    expect(msg.reply_to[0]).toContain(SAM);
    expect(msg.html).toContain(`/requests/${ref}`);
    expect(msg.text).toContain('Review and approve');
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
