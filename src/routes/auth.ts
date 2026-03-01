import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { GitHub, Discord, generateState } from 'arctic';
import { nanoid } from 'nanoid';
import { sql } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';

const github = new GitHub(
  process.env.GITHUB_CLIENT_ID || '',
  process.env.GITHUB_CLIENT_SECRET || '',
  null,
);

const discord = new Discord(
  process.env.DISCORD_CLIENT_ID || '',
  process.env.DISCORD_CLIENT_SECRET || '',
  process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/auth/discord/callback',
);

export const authRoutes = new Hono();

// GitHub OAuth
authRoutes.get('/github', async (c) => {
  const state = generateState();
  const url = github.createAuthorizationURL(state, ['user:email']);
  setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, maxAge: 600, path: '/' });
  return c.redirect(url.toString());
});

authRoutes.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'Missing code' }, 400);

  const tokens = await github.validateAuthorizationCode(code);
  const accessToken = tokens.accessToken();

  const ghUser = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => r.json()) as { id: number; login: string; name: string | null; avatar_url: string };

  const userId = nanoid();
  const sessionId = nanoid();

  // Upsert user
  await sql`
    INSERT INTO users (id, username, display_name, avatar_url, github_id)
    VALUES (${userId}, ${ghUser.login}, ${ghUser.name || ghUser.login}, ${ghUser.avatar_url}, ${String(ghUser.id)})
    ON CONFLICT (github_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = now()
  `;

  // Get actual user id after upsert
  const [user] = await sql`SELECT id FROM users WHERE github_id = ${String(ghUser.id)}`;

  // Create session (30 days)
  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${sessionId}, ${user.id}, now() + interval '30 days')
  `;

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  return c.redirect(process.env.APP_URL || 'http://localhost:5173');
});

// Discord OAuth
authRoutes.get('/discord', async (c) => {
  const state = generateState();
  const url = discord.createAuthorizationURL(state, null, ['identify']);
  setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, maxAge: 600, path: '/' });
  return c.redirect(url.toString());
});

authRoutes.get('/discord/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'Missing code' }, 400);

  const tokens = await discord.validateAuthorizationCode(code, null);
  const accessToken = tokens.accessToken();

  const dcUser = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => r.json()) as { id: string; username: string; global_name: string | null; avatar: string | null };

  const userId = nanoid();
  const sessionId = nanoid();
  const avatarUrl = dcUser.avatar
    ? `https://cdn.discordapp.com/avatars/${dcUser.id}/${dcUser.avatar}.png`
    : null;

  await sql`
    INSERT INTO users (id, username, display_name, avatar_url, discord_id)
    VALUES (${userId}, ${dcUser.username}, ${dcUser.global_name || dcUser.username}, ${avatarUrl}, ${dcUser.id})
    ON CONFLICT (discord_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      updated_at = now()
  `;

  const [user] = await sql`SELECT id FROM users WHERE discord_id = ${dcUser.id}`;

  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${sessionId}, ${user.id}, now() + interval '30 days')
  `;

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });

  return c.redirect(process.env.APP_URL || 'http://localhost:5173');
});

// Current user
authRoutes.get('/me', requireAuth, (c) => {
  return c.json(c.get('user'));
});

// Logout
authRoutes.post('/logout', requireAuth, async (c) => {
  const sessionId = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  if (sessionId) {
    await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
  }
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});
