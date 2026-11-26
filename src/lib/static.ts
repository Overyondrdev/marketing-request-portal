// The app's files, bundled into the Worker (scripts/build-static.mjs → src/generated/static.js). Served only after the
// sign-in check in src/index.ts. Unknown app paths get index.html so /requests/MR-1001 etc. work on reload.
import FILES from '../generated/static.js';

type File = { type: string; etag: string; text?: string; b64?: string };
const files = FILES as Record<string, File>;
const decoded = new Map<string, Uint8Array>();

function bodyOf(path: string, f: File): string | Uint8Array {
  if (f.text !== undefined) return f.text;
  let b = decoded.get(path);
  if (!b) {
    b = Uint8Array.from(atob(f.b64 || ''), (c) => c.charCodeAt(0));
    decoded.set(path, b);
  }
  return b;
}

export function serveStatic(request: Request, pathname: string): Response {
  let path = pathname === '/' ? '/index.html' : pathname;
  let f = files[path];
  // App routes (no file extension) render the app shell; missing files are a real 404.
  if (!f && !/\.[a-z0-9]+$/i.test(path)) f = files[(path = '/index.html')];
  if (!f) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  // Fonts and brand files rarely change; everything else revalidates (cheap, thanks to the ETag).
  const cache = /^\/brand\//.test(path) ? 'private, max-age=86400' : 'private, no-cache';
  const headers = { 'content-type': f.type, etag: f.etag, 'cache-control': cache };
  if (request.headers.get('if-none-match') === f.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : bodyOf(path, f), { headers });
}
