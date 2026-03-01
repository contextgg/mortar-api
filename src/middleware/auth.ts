import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
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

export const requireAuth = createMiddleware(async (c, next) => {
  const sessionId = getCookie(c, 'session');
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const rows = await sql`
    SELECT u.id, u.username, u.display_name, u.avatar_url
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > now()
  `;

  if (rows.length === 0) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', rows[0] as SessionUser);
  await next();
});

export const optionalAuth = createMiddleware(async (c, next) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    const rows = await sql`
      SELECT u.id, u.username, u.display_name, u.avatar_url
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ${sessionId} AND s.expires_at > now()
    `;
    if (rows.length > 0) {
      c.set('user', rows[0] as SessionUser);
    }
  }
  await next();
});
