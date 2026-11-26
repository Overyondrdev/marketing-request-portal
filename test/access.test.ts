// The Cloudflare Access check, without the local DEV_EMAIL shortcut.
import { describe, expect, it } from 'vitest';
import { allowedDomain, identify } from '../src/lib/access';

const env = { ACCESS_TEAM_DOMAIN: 'overyondr.cloudflareaccess.com', ALLOWED_EMAIL_DOMAINS: 'overyondr.com' };
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

describe('identify', () => {
  it('refuses requests without an Access token', async () => {
    expect(await identify(new Request('https://x/'), env)).toEqual({ error: 'unauthenticated' });
  });
  it('refuses a token with no valid signature', async () => {
    const forged = `${b64({ alg: 'none' })}.${b64({ email: 'eve@overyondr.com', iss: 'https://overyondr.cloudflareaccess.com', exp: 9e9 })}.`;
    const r = new Request('https://x/', { headers: { 'Cf-Access-Jwt-Assertion': forged } });
    expect(await identify(r, env)).toEqual({ error: 'unauthenticated' });
  });
  it('only lets Yondr addresses in', () => {
    expect(allowedDomain(env, 'sam@overyondr.com')).toBe(true);
    expect(allowedDomain(env, 'sam@overyondr.com.evil.io')).toBe(false);
    expect(allowedDomain(env, 'sam@gmail.com')).toBe(false);
  });
  it('maps a local DEV_EMAIL outside Yondr to forbidden', async () => {
    expect(await identify(new Request('https://x/'), { ...env, DEV_EMAIL: 'eve@example.com' })).toEqual({
      error: 'forbidden_domain',
      email: 'eve@example.com',
    });
  });
});

describe('Yondr Google sign-in session', () => {
  async function keys() {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
    return { kp, pub: JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid: 'test' }) };
  }
  const b64u = (b: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(b)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  async function token(kp: CryptoKeyPair, claims: Record<string, unknown>) {
    const enc = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
    const h = enc({ alg: 'ES256', typ: 'JWT', kid: 'test' });
    const p = enc(claims);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(sig)}`;
  }
  const now = () => Math.floor(Date.now() / 1000);
  const claims = (over = {}) => ({
    typ: 'session',
    iss: 'https://auth.overyondrdev.com',
    aud: 'overyondrdev.com',
    email: 'sam@overyondr.com',
    exp: now() + 60,
    ...over,
  });
  const req = (t: string) => new Request('https://x/', { headers: { cookie: `other=1; yondr_session=${t}` } });

  it('signs in with a valid session cookie, and refuses forged or foreign ones', async () => {
    const { kp, pub } = await keys();
    const e = { ...env, YONDR_AUTH_PUBLIC_JWK: pub };
    expect(await identify(req(await token(kp, claims())), e)).toEqual({ email: 'sam@overyondr.com' });
    expect(await identify(req(await token(kp, claims({ email: 'eve@gmail.com' }))), e)).toEqual({ error: 'unauthenticated' });
    expect(await identify(req(await token(kp, claims({ exp: now() - 5 }))), e)).toEqual({ error: 'unauthenticated' });
    const other = await keys();
    expect(await identify(req(await token(other.kp, claims())), e)).toEqual({ error: 'unauthenticated' });
  });
});
