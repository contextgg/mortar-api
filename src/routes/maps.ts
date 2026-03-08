import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { sql } from '../db/connection.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

export const mapRoutes = new Hono();

// List published maps
mapRoutes.get('/', optionalAuth, async (c) => {
  const search = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  let maps;
  if (search) {
    maps = await sql`
      SELECT m.id, m.slug, m.title, m.description, m.author_id,
             u.username as author_name, u.avatar_url as author_avatar,
             m.created_at, m.updated_at,
             (SELECT count(*) FROM map_likes ml WHERE ml.map_id = m.id) as likes
      FROM maps m
      JOIN users u ON u.id = m.author_id
      WHERE m.published = true AND (m.title ILIKE ${'%' + search + '%'} OR m.description ILIKE ${'%' + search + '%'})
      ORDER BY m.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    maps = await sql`
      SELECT m.id, m.slug, m.title, m.description, m.author_id,
             u.username as author_name, u.avatar_url as author_avatar,
             m.created_at, m.updated_at,
             (SELECT count(*) FROM map_likes ml WHERE ml.map_id = m.id) as likes
      FROM maps m
      JOIN users u ON u.id = m.author_id
      WHERE m.published = true
      ORDER BY m.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return c.json(maps);
});

// Get single map
mapRoutes.get('/:slug', optionalAuth, async (c) => {
  const [map] = await sql`
    SELECT m.*, u.username as author_name, u.avatar_url as author_avatar,
           (SELECT count(*) FROM map_likes ml WHERE ml.map_id = m.id) as likes
    FROM maps m
    JOIN users u ON u.id = m.author_id
    WHERE m.slug = ${c.req.param('slug')}
  `;

  if (!map) return c.json({ error: 'Map not found' }, 404);
  if (!map.published && map.author_id !== c.get('user')?.id) {
    return c.json({ error: 'Map not found' }, 404);
  }

  return c.json(map);
});

// Create map
mapRoutes.post('/', requireAuth, async (c) => {
  const body = await c.req.json();
  const id = nanoid();
  const slug = `${body.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'untitled'}-${nanoid(6)}`;

  const [map] = await sql`
    INSERT INTO maps (id, slug, title, description, data, author_id, published, forked_from)
    VALUES (${id}, ${slug}, ${body.title || 'Untitled'}, ${body.description || null}, ${JSON.stringify(body.data)}, ${c.get('user').id}, ${body.published || false}, ${body.forked_from || null})
    RETURNING *
  `;

  return c.json(map, 201);
});

// Update map
mapRoutes.put('/:slug', requireAuth, async (c) => {
  const body = await c.req.json();
  const user = c.get('user');

  const [existing] = await sql`SELECT * FROM maps WHERE slug = ${c.req.param('slug')}`;
  if (!existing) return c.json({ error: 'Map not found' }, 404);
  if (existing.author_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  const [map] = await sql`
    UPDATE maps SET
      title = ${body.title ?? existing.title},
      description = ${body.description ?? existing.description},
      data = ${body.data ? JSON.stringify(body.data) : existing.data},
      published = ${body.published ?? existing.published},
      updated_at = now()
    WHERE slug = ${c.req.param('slug')}
    RETURNING *
  `;

  return c.json(map);
});

// Delete map
mapRoutes.delete('/:slug', requireAuth, async (c) => {
  const user = c.get('user');
  const [existing] = await sql`SELECT * FROM maps WHERE slug = ${c.req.param('slug')}`;
  if (!existing) return c.json({ error: 'Map not found' }, 404);
  if (existing.author_id !== user.id) return c.json({ error: 'Forbidden' }, 403);

  await sql`DELETE FROM maps WHERE slug = ${c.req.param('slug')}`;
  return c.json({ ok: true });
});

// Fork map
mapRoutes.post('/:slug/fork', requireAuth, async (c) => {
  const user = c.get('user');
  const [original] = await sql`SELECT * FROM maps WHERE slug = ${c.req.param('slug')} AND published = true`;
  if (!original) return c.json({ error: 'Map not found' }, 404);

  const id = nanoid();
  const slug = `${original.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${nanoid(6)}`;

  const [map] = await sql`
    INSERT INTO maps (id, slug, title, description, data, author_id, forked_from)
    VALUES (${id}, ${slug}, ${original.title}, ${original.description}, ${original.data}, ${user.id}, ${original.id})
    RETURNING *
  `;

  return c.json(map, 201);
});

// Get map rotation (maps available for matchmaking)
mapRoutes.get('/rotation', async (c) => {
  const maps = await sql`
    SELECT m.id, m.slug, m.title, m.description,
           length(m.data::text)::bigint as size,
           m.updated_at
    FROM map_rotation mr
    JOIN maps m ON m.id = mr.map_id
    WHERE m.published = true
    ORDER BY mr.added_at
  `;
  return c.json(maps);
});

// Download a map's data by slug (for client and server sync)
mapRoutes.get('/:slug/download', async (c) => {
  const [map] = await sql`
    SELECT m.data FROM maps m
    WHERE m.slug = ${c.req.param('slug')} AND m.published = true
  `;
  if (!map) return c.json({ error: 'Map not found' }, 404);

  return c.json(map.data);
});

// Like/unlike map
mapRoutes.post('/:slug/like', requireAuth, async (c) => {
  const user = c.get('user');
  const [map] = await sql`SELECT id FROM maps WHERE slug = ${c.req.param('slug')} AND published = true`;
  if (!map) return c.json({ error: 'Map not found' }, 404);

  const [existing] = await sql`SELECT * FROM map_likes WHERE user_id = ${user.id} AND map_id = ${map.id}`;
  if (existing) {
    await sql`DELETE FROM map_likes WHERE user_id = ${user.id} AND map_id = ${map.id}`;
    return c.json({ liked: false });
  } else {
    await sql`INSERT INTO map_likes (user_id, map_id) VALUES (${user.id}, ${map.id})`;
    return c.json({ liked: true });
  }
});
