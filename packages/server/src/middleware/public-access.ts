import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface PublicAccessPolicy {
  /** Shared secrets for server-to-server callers (a paid API's backend). Empty = no key accepted. */
  apiKeys: string[];
  /** Browser origins allowed to call, e.g. https://app.example.com. Empty = no origin accepted. */
  allowedOrigins: string[];
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

/** Reads FREE_FACILITATOR_API_KEYS and FREE_FACILITATOR_ALLOWED_ORIGINS (comma separated). */
export function readPublicAccessPolicy(env: NodeJS.ProcessEnv = process.env): PublicAccessPolicy {
  return {
    apiKeys: splitList(env.FREE_FACILITATOR_API_KEYS),
    allowedOrigins: splitList(env.FREE_FACILITATOR_ALLOWED_ORIGINS).map(normalizeOrigin),
  };
}

/** Open when neither list is configured (development). Once either is set, callers must match one. */
export function isRestricted(policy: PublicAccessPolicy): boolean {
  return policy.apiKeys.length > 0 || policy.allowedOrigins.length > 0;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** The only part of a request this module reads, so it can be tested without Express. */
export interface HeaderSource {
  header(name: string): string | undefined;
}

function presentedKey(req: HeaderSource): string | undefined {
  const auth = req.header('authorization');
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return req.header('x-facilitator-key')?.trim() || undefined;
}

export function isAllowed(policy: PublicAccessPolicy, req: HeaderSource): boolean {
  if (!isRestricted(policy)) return true;
  const key = presentedKey(req);
  if (key && policy.apiKeys.some((k) => safeEqual(k, key))) return true;
  const origin = req.header('origin');
  if (origin && policy.allowedOrigins.includes(normalizeOrigin(origin))) return true;
  return false;
}

/**
 * Gate for the endpoints that cost the operator gas (/free/verify, /free/settle).
 * Allowed: a valid API key, or a browser request whose Origin is on the allow-list.
 * Note: Origin is set by browsers and can be forged by any other client, so it only restricts
 * browsers. Server-to-server callers should use an API key.
 */
export function requirePublicAccess(policy: PublicAccessPolicy = readPublicAccessPolicy()) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isAllowed(policy, req as HeaderSource)) {
      next();
      return;
    }
    res.status(403).json({
      isValid: false,
      success: false,
      error: 'forbidden',
      invalidReason: 'This facilitator only accepts requests from approved callers.',
    });
  };
}
