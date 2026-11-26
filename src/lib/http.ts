// Small HTTP helpers shared by the API modules.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const now = () => new Date().toISOString();
export const today = () => now().slice(0, 10);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

export async function body<T = Record<string, any>>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text) return {} as T;
  if (text.length > 1_000_000) fail(413, 'That is too much to send at once.');
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'Expected a JSON object.');
    return v as T;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(400, 'Expected JSON.');
  }
}

export const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const isEmail = (v: unknown): v is string => typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
export const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
export const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** Security headers for every response. Scripts only from this origin; nothing may frame the portal. */
export function secure(res: Response, html = false): Response {
  const r = new Response(res.body, res);
  const h = r.headers;
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'same-origin');
  h.set('x-robots-tag', 'noindex, nofollow');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  h.set('x-frame-options', 'DENY');
  if (html) {
    h.set(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    );
  }
  return r;
}
