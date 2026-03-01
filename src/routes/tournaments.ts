import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { sql } from '../db/connection.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

export const tournamentRoutes = new Hono();

// List tournaments
tournamentRoutes.get('/', optionalAuth, async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const tournaments = status
    ? await sql`
        SELECT t.*, u.username as organizer_name,
               (SELECT count(*) FROM tournament_participants tp WHERE tp.tournament_id = t.id) as player_count
        FROM tournaments t
        JOIN users u ON u.id = t.organizer_id
        WHERE t.status = ${status}
        ORDER BY t.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    : await sql`
        SELECT t.*, u.username as organizer_name,
               (SELECT count(*) FROM tournament_participants tp WHERE tp.tournament_id = t.id) as player_count
        FROM tournaments t
        JOIN users u ON u.id = t.organizer_id
        ORDER BY t.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

  return c.json(tournaments);
});

// Get tournament
tournamentRoutes.get('/:id', async (c) => {
  const [tournament] = await sql`
    SELECT t.*, u.username as organizer_name
    FROM tournaments t
    JOIN users u ON u.id = t.organizer_id
    WHERE t.id = ${c.req.param('id')}
  `;

  if (!tournament) return c.json({ error: 'Tournament not found' }, 404);

  const participants = await sql`
    SELECT u.id, u.username, u.display_name, u.avatar_url, tp.seed, tp.joined_at
    FROM tournament_participants tp
    JOIN users u ON u.id = tp.user_id
    WHERE tp.tournament_id = ${c.req.param('id')}
    ORDER BY tp.seed ASC NULLS LAST
  `;

  const matches = await sql`
    SELECT m.*,
           p1.username as player1_name, p2.username as player2_name,
           w.username as winner_name
    FROM matches m
    LEFT JOIN users p1 ON p1.id = m.player1_id
    LEFT JOIN users p2 ON p2.id = m.player2_id
    LEFT JOIN users w ON w.id = m.winner_id
    WHERE m.tournament_id = ${c.req.param('id')}
    ORDER BY m.round, m.position
  `;

  return c.json({ ...tournament, participants, matches });
});

// Create tournament
tournamentRoutes.post('/', requireAuth, async (c) => {
  const body = await c.req.json();
  const id = nanoid();

  const [tournament] = await sql`
    INSERT INTO tournaments (id, title, description, map_id, organizer_id, max_players, starts_at)
    VALUES (${id}, ${body.title}, ${body.description || null}, ${body.map_id || null}, ${c.get('user').id}, ${body.max_players || 16}, ${body.starts_at || null})
    RETURNING *
  `;

  return c.json(tournament, 201);
});

// Join tournament
tournamentRoutes.post('/:id/join', requireAuth, async (c) => {
  const user = c.get('user');
  const [tournament] = await sql`SELECT * FROM tournaments WHERE id = ${c.req.param('id')}`;
  if (!tournament) return c.json({ error: 'Tournament not found' }, 404);
  if (tournament.status !== 'open') return c.json({ error: 'Tournament is not open' }, 400);

  const [count] = await sql`SELECT count(*) FROM tournament_participants WHERE tournament_id = ${tournament.id}`;
  if (parseInt(count.count) >= tournament.max_players) {
    return c.json({ error: 'Tournament is full' }, 400);
  }

  await sql`
    INSERT INTO tournament_participants (tournament_id, user_id)
    VALUES (${tournament.id}, ${user.id})
    ON CONFLICT DO NOTHING
  `;

  return c.json({ ok: true });
});

// Leave tournament
tournamentRoutes.post('/:id/leave', requireAuth, async (c) => {
  const user = c.get('user');
  const [tournament] = await sql`SELECT * FROM tournaments WHERE id = ${c.req.param('id')}`;
  if (!tournament) return c.json({ error: 'Tournament not found' }, 404);
  if (tournament.status !== 'open') return c.json({ error: 'Cannot leave started tournament' }, 400);

  await sql`DELETE FROM tournament_participants WHERE tournament_id = ${tournament.id} AND user_id = ${user.id}`;
  return c.json({ ok: true });
});
