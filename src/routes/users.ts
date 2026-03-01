import { Hono } from 'hono';
import { sql } from '../db/connection.js';

export const userRoutes = new Hono();

// Get user profile
userRoutes.get('/:username', async (c) => {
  const [user] = await sql`
    SELECT id, username, display_name, avatar_url, created_at
    FROM users
    WHERE username = ${c.req.param('username')}
  `;

  if (!user) return c.json({ error: 'User not found' }, 404);

  const maps = await sql`
    SELECT id, slug, title, description, created_at, updated_at,
           (SELECT count(*) FROM map_likes ml WHERE ml.map_id = m.id) as likes
    FROM maps m
    WHERE author_id = ${user.id} AND published = true
    ORDER BY updated_at DESC
  `;

  const stats = await sql`
    SELECT
      (SELECT count(*) FROM maps WHERE author_id = ${user.id} AND published = true) as map_count,
      (SELECT count(*) FROM map_likes ml JOIN maps m ON m.id = ml.map_id WHERE m.author_id = ${user.id}) as total_likes,
      (SELECT count(*) FROM tournament_participants WHERE user_id = ${user.id}) as tournaments_played
  `;

  return c.json({ ...user, maps, stats: stats[0] });
});
