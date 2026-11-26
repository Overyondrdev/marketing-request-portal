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
