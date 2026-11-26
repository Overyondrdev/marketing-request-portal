// yondr-marketing-requests: the Worker. Every request is checked for a Yondr sign-in (src/lib/access.ts) before
// anything is served, including the app's static files. /api/* is the JSON API; everything else is the app.

import { act, create, get, home, list, patch, removeDraft, watch } from './api/requests';
import { changeComment, postComment } from './api/conversation';
import { download, removeFile, upload } from './api/files';
import { exportCsv, report } from './api/reports';
import { people, savePerson, saveType, types } from './api/admin';
import { catalogSettings, directory, saveProfile, whoami } from './api/me';
import { reminders } from './cron';
import { identify } from './lib/access';
import { HttpError, json, secure } from './lib/http';
import { inbox, markRead } from './lib/notify';
import { signIn, type Me } from './lib/users';

type Handler = (env: Env, ctx: ExecutionContext, me: Me, req: Request, url: URL, params: string[]) => Promise<Response> | Response;
const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/me$/, (env, _c, me) => whoami(env, me)],
  ['PATCH', /^\/api\/me$/, (env, _c, me, req) => saveProfile(env, me, req)],
  ['GET', /^\/api\/people$/, (env) => directory(env)],
  ['GET', /^\/api\/catalog$/, (env) => catalogSettings(env)],
  ['GET', /^\/api\/home$/, (env, _c, me) => home(env, me)],
  ['GET', /^\/api\/notifications$/, async (env, _c, me) => json(await inbox(env, me.email))],
  [
    'POST',
    /^\/api\/notifications\/read$/,
    async (env, _c, me, req) => (await markRead(env, me.email, await req.json<any>().catch(() => ({}))), json({ ok: true })),
  ],

  ['GET', /^\/api\/requests$/, (env, _c, me, _r, url) => list(env, me, url)],
  ['POST', /^\/api\/requests$/, (env, _c, me, req) => create(env, me, req)],
  ['GET', /^\/api\/requests\/([\w-]+)$/, (env, _c, me, _r, _u, [ref]) => get(env, me, ref)],
  ['PATCH', /^\/api\/requests\/([\w-]+)$/, (env, _c, me, req, _u, [ref]) => patch(env, me, ref, req)],
  ['DELETE', /^\/api\/requests\/([\w-]+)$/, (env, _c, me, _r, _u, [ref]) => removeDraft(env, me, ref)],
  ['POST', /^\/api\/requests\/([\w-]+)\/actions\/(\w+)$/, (env, ctx, me, req, _u, [ref, a]) => act(env, ctx, me, ref, a, req)],
  ['POST', /^\/api\/requests\/([\w-]+)\/comments$/, (env, ctx, me, req, _u, [ref]) => postComment(env, ctx, me, ref, req)],
  ['POST', /^\/api\/requests\/([\w-]+)\/watchers$/, (env, _c, me, req, _u, [ref]) => watch(env, me, ref, req)],
  ['DELETE', /^\/api\/requests\/([\w-]+)\/watchers$/, (env, _c, me, req, _u, [ref]) => watch(env, me, ref, req)],
  ['PUT', /^\/api\/requests\/([\w-]+)\/files$/, (env, _c, me, req, url, [ref]) => upload(env, me, ref, req, url)],
  ['PATCH', /^\/api\/comments\/(\d+)$/, (env, _c, me, req, _u, [id]) => changeComment(env, me, Number(id), req)],
  ['POST', /^\/api\/comments\/(\d+)$/, (env, _c, me, req, _u, [id]) => changeComment(env, me, Number(id), req)],
  ['DELETE', /^\/api\/comments\/(\d+)$/, (env, _c, me, req, _u, [id]) => changeComment(env, me, Number(id), req)],
  ['GET', /^\/api\/files\/([\w-]+)$/, (env, _c, me, _r, url, [id]) => download(env, me, id, url)],
  ['DELETE', /^\/api\/files\/([\w-]+)$/, (env, _c, me, _r, _u, [id]) => removeFile(env, me, id)],

  ['GET', /^\/api\/reports$/, (env, _c, me, _r, url) => report(env, me, url)],
  ['GET', /^\/api\/reports\/export\.csv$/, (env, _c, me, _r, url) => exportCsv(env, me, url)],
  ['GET', /^\/api\/admin\/people$/, (env, _c, me) => people(env, me)],
  ['PUT', /^\/api\/admin\/people\/([^/]+)$/, (env, ctx, me, req, _u, [email]) => savePerson(env, ctx, me, email, req)],
  ['GET', /^\/api\/admin\/types$/, (env, _c, me) => types(env, me)],
  ['PUT', /^\/api\/admin\/types\/([\w-]+)$/, (env, _c, me, req, _u, [id]) => saveType(env, me, id, req)],
];

function denied(kind: 'unauthenticated' | 'forbidden_domain', api: boolean): Response {
  const msg =
    kind === 'forbidden_domain'
      ? 'The marketing request portal is only for people at Yondr. Sign in with your @overyondr.com email.'
      : 'Please sign in with your Yondr email to use the marketing request portal.';
  if (api) return json({ error: msg, code: kind }, kind === 'forbidden_domain' ? 403 : 401);
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Yondr</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#1C300B;color:#F4F9D1;font:16px/1.5 Arial,sans-serif;padding:24px">
<main style="max-width:420px;text-align:center"><h1 style="font:500 28px/1.2 Georgia,serif;margin:0 0 12px">Yondr marketing requests</h1>
<p style="margin:0 0 20px">${msg}</p><a href="/cdn-cgi/access/logout" style="color:#DAFF6B;font-weight:700">Sign in again</a></main></body></html>`,
    {
      status: kind === 'forbidden_domain' ? 403 : 401,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  );
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const api = url.pathname.startsWith('/api/');

  // Brand files and fonts are public (they're on overyondr.com anyway); everything else needs a Yondr sign-in.
  if (url.pathname.startsWith('/brand/') && request.method === 'GET') return env.ASSETS.fetch(request);

  const who = await identify(request, env);
  if ('error' in who) return denied(who.error, api);

  if (!api) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    return env.ASSETS.fetch(request);
  }

  // Cross-site request forgery: state-changing API calls must come from this origin with our header,
  // which a cross-site form or image can't send (a fetch with it needs a CORS preflight, which we never grant).
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (request.headers.get('x-requested-with') !== 'mrp' || (origin && new URL(origin).host !== url.host))
      return json({ error: 'Request blocked. Reload the page and try again.' }, 403);
  }

  const me = await signIn(env, who.email);
  for (const [method, re, fn] of routes) {
    if (method !== request.method && !(method === 'GET' && request.method === 'HEAD')) continue;
    const m = url.pathname.match(re);
    if (m) return fn(env, ctx, me, request, url, m.slice(1));
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    try {
      const res = await handle(request, env, ctx);
      const html = (res.headers.get('content-type') || '').includes('text/html');
      return secure(res, html);
    } catch (e) {
      if (e instanceof HttpError) return secure(json({ error: e.message, ...e.extra }, e.status));
      console.error('unhandled', url.pathname, e);
      return secure(json({ error: 'Something went wrong on our side. Try again in a moment.' }, 500));
    }
  },
  async scheduled(_event, env, ctx): Promise<void> {
    await reminders(env, ctx);
  },
} satisfies ExportedHandler<Env>;
