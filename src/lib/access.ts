// Who is signed in. Cloudflare Access signs people in at the edge (one-time code to an @overyondr.com address) and
// adds a signed token, Cf-Access-Jwt-Assertion, to every request it lets through. The Worker verifies that token
// (signature against the Yondr team's keys, issuer, expiry, not-before) and takes the email from it, then checks the
// email's domain against ALLOWED_EMAIL_DOMAINS. So the portal stays private to Yondr even if the host were ever
// left out of Access, or another Access app with a wider policy issued the token.

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  DEV_EMAIL?: string;
}
interface Jwk extends JsonWebKey {
  kid?: string;
}

let keys: Jwk[] | null = null;
let keysAt = 0;

function b64url(s: string): Uint8Array<ArrayBuffer> {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function certs(team: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && keys && Date.now() - keysAt < 3600_000) return keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Access certs ' + res.status);
  keys = ((await res.json()) as { keys?: Jwk[] }).keys || [];
  keysAt = Date.now();
  return keys;
}

export function allowedDomain(env: AccessEnv, email: string): boolean {
  const domains = (env.ALLOWED_EMAIL_DOMAINS || 'overyondr.com')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const at = email.lastIndexOf('@');
  return at > 0 && domains.includes(email.slice(at + 1));
}

export type Identity = { email: string } | { error: 'unauthenticated' | 'forbidden_domain'; email?: string };

/** The signed-in person, or why there isn't one. */
export async function identify(request: Request, env: AccessEnv): Promise<Identity> {
  const email = await accessEmail(request, env);
  if (!email) return { error: 'unauthenticated' };
  if (!allowedDomain(env, email)) return { error: 'forbidden_domain', email };
  return { email };
}

async function accessEmail(request: Request, env: AccessEnv): Promise<string | null> {
  // Local development only (.dev.vars). Never set DEV_EMAIL in production. X-Dev-Email lets you act as someone else.
  if (env.DEV_EMAIL) return (request.headers.get('X-Dev-Email') || env.DEV_EMAIL).trim().toLowerCase();
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN) return null;
  try {
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return null;
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
    if (header.alg !== 'RS256') return null;
    let jwk = (await certs(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await certs(env.ACCESS_TEAM_DOMAIN, true)).find((k) => k.kid === header.kid); // keys rotated
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const now = Date.now() / 1000;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (!payload.exp || payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 60) return null;
    return payload.email ? String(payload.email).trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
