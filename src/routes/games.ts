import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { sql } from '../db/connection.js';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

export const gameRoutes = new Hono();

// List all games
gameRoutes.get('/', async (c) => {
  const games = await sql`
    SELECT g.slug, g.name, g.description, g.icon_url,
      (SELECT gr.version FROM game_releases gr WHERE gr.game_slug = g.slug ORDER BY gr.pub_date DESC LIMIT 1) as latest_version
    FROM games g
    ORDER BY g.name
  `;
  return c.json(games);
});

// Get latest release for a game
gameRoutes.get('/:slug/releases/latest', async (c) => {
  const { slug } = c.req.param();

  const releases = await sql`
    SELECT gr.id, gr.version, gr.changelog, gr.pub_date
    FROM game_releases gr
    WHERE gr.game_slug = ${slug}
    ORDER BY gr.pub_date DESC
    LIMIT 1
  `;

  if (releases.length === 0) {
    return c.json({ error: 'No releases found' }, 404);
  }

  const release = releases[0];

  const assets = await sql`
    SELECT platform, url, size
    FROM game_release_assets
    WHERE release_id = ${release.id}
  `;

  const platforms: Record<string, { url: string; size: number | null }> = {};
  for (const asset of assets) {
    platforms[asset.platform] = { url: asset.url, size: asset.size };
  }

  return c.json({
    version: release.version,
    changelog: release.changelog,
    pub_date: release.pub_date,
    platforms,
  });
});

// Sync releases from GitHub — called by GitHub Actions after a release
// Secured with a shared secret
gameRoutes.post('/:slug/releases/sync', async (c) => {
  const secret = c.req.header('X-Webhook-Secret');
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { slug } = c.req.param();

  // Verify game exists and get its GitHub repo
  const games = await sql`SELECT slug, github_repo FROM games WHERE slug = ${slug}`;
  if (games.length === 0) {
    return c.json({ error: 'Game not found' }, 404);
  }

  const game = games[0];
  const repo = game.github_repo;

  // Fetch latest release from GitHub API
  const ghToken = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'mortar-api',
  };
  if (ghToken) {
    headers['Authorization'] = `Bearer ${ghToken}`;
  }

  const ghRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (!ghRes.ok) {
    return c.json({ error: `GitHub API error: ${ghRes.status}` }, 502);
  }

  const ghRelease = await ghRes.json() as {
    tag_name: string;
    body: string | null;
    published_at: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  };

  const version = ghRelease.tag_name.replace(/^v/, '');

  // Upsert the release
  const releaseId = nanoid();
  const releases = await sql`
    INSERT INTO game_releases (id, game_slug, version, changelog, pub_date)
    VALUES (${releaseId}, ${slug}, ${version}, ${ghRelease.body || ''}, ${ghRelease.published_at})
    ON CONFLICT (game_slug, version) DO UPDATE SET
      changelog = EXCLUDED.changelog,
      pub_date = EXCLUDED.pub_date
    RETURNING id
  `;
  const finalReleaseId = releases[0].id;

  // Map GitHub asset names to platform keys
  const platformMap: Record<string, string> = {
    'mortar-linux-x86_64.tar.gz': 'linux-x86_64',
    'mortar-windows-x86_64.zip': 'windows-x86_64',
    'mortar-darwin-x86_64.tar.gz': 'darwin-x86_64',
    'mortar-darwin-aarch64.tar.gz': 'darwin-aarch64',
  };

  let assetsUpserted = 0;
  for (const asset of ghRelease.assets) {
    const platform = platformMap[asset.name];
    if (!platform) continue;

    await sql`
      INSERT INTO game_release_assets (id, release_id, platform, url, size)
      VALUES (${nanoid()}, ${finalReleaseId}, ${platform}, ${asset.browser_download_url}, ${asset.size})
      ON CONFLICT (release_id, platform) DO UPDATE SET
        url = EXCLUDED.url,
        size = EXCLUDED.size
    `;
    assetsUpserted++;
  }

  return c.json({
    ok: true,
    version,
    assets_synced: assetsUpserted,
  });
});
