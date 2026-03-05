import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sql } from '../db/connection.js';

export type SessionUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUser;
  }
}

const oidcIssuer = process.env.OIDC_ISSUER || 'http://localhost:3000';
const JWKS = createRemoteJWKSet(new URL(`${oidcIssuer}/oidc/jwks`));

async function getUserFromBearer(authHeader: string | undefined): Promise<SessionUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: oidcIssuer,
      audience: 'https://api.ctx.gg',
    });

    if (!payload.sub) return null;

    const rows = await sql`
      SELECT id, username, display_name, avatar_url
      FROM users WHERE id = ${payload.sub}
    `;
    return (rows[0] as SessionUser) || null;
  } catch {
    return null;
  }
}

async function getUserFromSession(sessionId: string): Promise<SessionUser | null> {
  const rows = await sql`
    SELECT u.id, u.username, u.display_name, u.avatar_url
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > now()
  `;
  return (rows[0] as SessionUser) || null;
}

export const requireAuth = createMiddleware(async (c, next) => {
  // Try Bearer token first
  const user = await getUserFromBearer(c.req.header('Authorization'));
  if (user) {
    c.set('user', user);
    return next();
  }

  // Fall back to session cookie
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    const sessionUser = await getUserFromSession(sessionId);
    if (sessionUser) {
      c.set('user', sessionUser);
      return next();
    }
  }

  return c.json({ error: 'Unauthorized' }, 401);
});

export const optionalAuth = createMiddleware(async (c, next) => {
  // Try Bearer token first
  const user = await getUserFromBearer(c.req.header('Authorization'));
  if (user) {
    c.set('user', user);
    return next();
  }

  // Fall back to session cookie
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    const sessionUser = await getUserFromSession(sessionId);
    if (sessionUser) {
      c.set('user', sessionUser);
    }
  }

  return next();
});
