import { describe, expect, it } from 'vitest';
import { isAllowed, readPublicAccessPolicy } from './public-access.js';

const req = (headers: Record<string, string>) => ({
  header: (n: string) => headers[n.toLowerCase()],
});

describe('public access policy', () => {
  it('is open when nothing is configured', () => {
    expect(isAllowed(readPublicAccessPolicy({}), req({}))).toBe(true);
  });

  const policy = readPublicAccessPolicy({
    FREE_FACILITATOR_API_KEYS: 'k1, k2',
    FREE_FACILITATOR_ALLOWED_ORIGINS: 'https://App.example.com/, https://b.example.com',
  });

  it('accepts a configured key as bearer or x-facilitator-key', () => {
    expect(isAllowed(policy, req({ authorization: 'Bearer k2' }))).toBe(true);
    expect(isAllowed(policy, req({ 'x-facilitator-key': 'k1' }))).toBe(true);
  });

  it('rejects wrong keys, and a lookalike of different length', () => {
    expect(isAllowed(policy, req({ authorization: 'Bearer nope' }))).toBe(false);
    expect(isAllowed(policy, req({ authorization: 'Bearer k11' }))).toBe(false);
  });

  it('accepts allowed origins regardless of case or trailing slash, rejects others', () => {
    expect(isAllowed(policy, req({ origin: 'https://app.example.com' }))).toBe(true);
    expect(isAllowed(policy, req({ origin: 'https://evil.example.com' }))).toBe(false);
  });

  it('rejects callers with neither key nor origin once restricted', () => {
    expect(isAllowed(policy, req({}))).toBe(false);
  });

  it('with only origins set, a key header alone does not pass', () => {
    const p = readPublicAccessPolicy({ FREE_FACILITATOR_ALLOWED_ORIGINS: 'https://a.example.com' });
    expect(isAllowed(p, req({ authorization: 'Bearer anything' }))).toBe(false);
  });
});
