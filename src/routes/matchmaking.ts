import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { sql } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import * as crypto from 'crypto';

export const matchmakingRoutes = new Hono();

// In-memory matchmaking queue (simple for now, can be Redis later)
type QueueEntry = {
  userId: string;
  username: string;
  joinedAt: number;
};

const queue: QueueEntry[] = [];
const MATCH_SIZE = 2; // Players needed to start a match

// Join matchmaking queue
matchmakingRoutes.post('/queue', requireAuth, async (c) => {
  const user = c.get('user');

  // Check player isn't already in queue
  const existing = queue.find((e) => e.userId === user.id);
  if (existing) {
    return c.json({ status: 'queued', position: queue.indexOf(existing) + 1 });
  }

  // Check player isn't already in an active session
  const activeSessions = await sql`
    SELECT gs.id FROM game_sessions gs
    JOIN game_session_players gsp ON gsp.session_id = gs.id
    WHERE gsp.user_id = ${user.id} AND gs.status IN ('starting', 'running')
  `;
  if (activeSessions.length > 0) {
    return c.json({ error: 'Already in an active game session' }, 409);
  }

  queue.push({
    userId: user.id,
    username: user.username,
    joinedAt: Date.now(),
  });

  // Try to form a match
  if (queue.length >= MATCH_SIZE) {
    const players = queue.splice(0, MATCH_SIZE);
    const session = await createSession(players);
    return c.json({ status: 'matched', session });
  }

  return c.json({ status: 'queued', position: queue.length });
});

// Leave matchmaking queue
matchmakingRoutes.delete('/queue', requireAuth, async (c) => {
  const user = c.get('user');
  const idx = queue.findIndex((e) => e.userId === user.id);
  if (idx >= 0) queue.splice(idx, 1);
  return c.json({ ok: true });
});

// Check queue status / poll for match
matchmakingRoutes.get('/queue', requireAuth, async (c) => {
  const user = c.get('user');

  // Check if player got matched into a session
  const sessions = await sql`
    SELECT gs.id, gs.map_id, gs.server_addr, gs.server_port, gs.status,
           gsp.token,
           m.slug as map_slug, m.title as map_title
    FROM game_sessions gs
    JOIN game_session_players gsp ON gsp.session_id = gs.id
    JOIN maps m ON m.id = gs.map_id
    WHERE gsp.user_id = ${user.id} AND gs.status IN ('starting', 'running')
    ORDER BY gs.created_at DESC
    LIMIT 1
  `;

  if (sessions.length > 0) {
    const s = sessions[0];
    return c.json({
      status: 'matched',
      session: {
        id: s.id,
        map_slug: s.map_slug,
        map_title: s.map_title,
        server_addr: s.server_addr,
        server_port: s.server_port,
        token: s.token,
        server_status: s.status,
      },
    });
  }

  const idx = queue.findIndex((e) => e.userId === user.id);
  if (idx >= 0) {
    return c.json({ status: 'queued', position: idx + 1 });
  }

  return c.json({ status: 'idle' });
});

async function createSession(players: QueueEntry[]) {
  // Pick a random map from rotation
  const rotationMaps = await sql`
    SELECT m.id, m.slug, m.title
    FROM map_rotation mr
    JOIN maps m ON m.id = mr.map_id
    WHERE m.published = true
    ORDER BY random()
    LIMIT 1
  `;

  if (rotationMaps.length === 0) {
    // No maps in rotation — put players back in queue
    queue.unshift(...players);
    return null;
  }

  const map = rotationMaps[0];
  const sessionId = nanoid();

  // Create session (server_addr will be set when the server starts)
  await sql`
    INSERT INTO game_sessions (id, map_id, status)
    VALUES (${sessionId}, ${map.id}, 'starting')
  `;

  // Generate tokens and add players
  const playerTokens: Array<{ userId: string; token: string }> = [];
  for (const player of players) {
    const token = crypto.randomBytes(32).toString('hex');
    await sql`
      INSERT INTO game_session_players (session_id, user_id, token)
      VALUES (${sessionId}, ${player.userId}, ${token})
    `;
    playerTokens.push({ userId: player.userId, token });
  }

  // TODO: Start a Fly Machine here
  // For now, the session is created and waiting for a server to claim it

  return {
    id: sessionId,
    map_slug: map.slug,
    map_title: map.title,
    players: playerTokens.map((p) => ({
      userId: p.userId,
      token: p.token,
    })),
  };
}

// --- Server-side endpoints (called by game servers) ---

const SERVER_SECRET = process.env.SERVER_SECRET || '';

// Game server claims a session and reports its address
matchmakingRoutes.post('/sessions/:id/claim', async (c) => {
  const secret = c.req.header('X-Server-Secret');
  if (!SERVER_SECRET || secret !== SERVER_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();
  const body = await c.req.json() as { server_addr: string; server_port: number };

  const sessions = await sql`
    UPDATE game_sessions
    SET server_addr = ${body.server_addr}, server_port = ${body.server_port}, status = 'running'
    WHERE id = ${id} AND status = 'starting'
    RETURNING id
  `;

  if (sessions.length === 0) {
    return c.json({ error: 'Session not found or already claimed' }, 404);
  }

  // Return the expected player tokens so the server can validate connections
  const players = await sql`
    SELECT user_id, token FROM game_session_players WHERE session_id = ${id}
  `;

  return c.json({ ok: true, players });
});

// Game server reports session complete
matchmakingRoutes.post('/sessions/:id/finish', async (c) => {
  const secret = c.req.header('X-Server-Secret');
  if (!SERVER_SECRET || secret !== SERVER_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  await sql`
    UPDATE game_sessions
    SET status = 'finished', finished_at = now()
    WHERE id = ${id}
  `;

  return c.json({ ok: true });
});

// Get session info (for game server to know what map to load and who to expect)
matchmakingRoutes.get('/sessions/:id', async (c) => {
  const secret = c.req.header('X-Server-Secret');
  if (!SERVER_SECRET || secret !== SERVER_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  const sessions = await sql`
    SELECT gs.id, gs.status, gs.server_addr, gs.server_port,
           m.slug as map_slug
    FROM game_sessions gs
    JOIN maps m ON m.id = gs.map_id
    WHERE gs.id = ${id}
  `;

  if (sessions.length === 0) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const players = await sql`
    SELECT user_id, token FROM game_session_players WHERE session_id = ${id}
  `;

  return c.json({ ...sessions[0], players });
});
