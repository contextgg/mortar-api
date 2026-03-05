-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  github_id TEXT UNIQUE,
  discord_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Maps
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  data JSONB NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  forked_from TEXT REFERENCES maps(id) ON DELETE SET NULL,
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maps_author_id ON maps(author_id);
CREATE INDEX IF NOT EXISTS idx_maps_published ON maps(published) WHERE published = true;

-- Map likes
CREATE TABLE IF NOT EXISTS map_likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, map_id)
);

-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  map_id TEXT REFERENCES maps(id) ON DELETE SET NULL,
  organizer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  max_players INTEGER NOT NULL DEFAULT 16,
  starts_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tournament participants
CREATE TABLE IF NOT EXISTS tournament_participants (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed INTEGER,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);

-- Matches
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  position INTEGER NOT NULL,
  player1_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  player2_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  winner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_id ON matches(tournament_id);

-- Games (downloadable via desktop app)
CREATE TABLE IF NOT EXISTS games (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon_url TEXT,
  github_repo TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Game releases
CREATE TABLE IF NOT EXISTS game_releases (
  id TEXT PRIMARY KEY,
  game_slug TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  version TEXT NOT NULL,
  changelog TEXT,
  pub_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_slug, version)
);

CREATE INDEX IF NOT EXISTS idx_game_releases_game_slug ON game_releases(game_slug);

-- Platform-specific download assets for a release
CREATE TABLE IF NOT EXISTS game_release_assets (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES game_releases(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  storage_key TEXT,
  size BIGINT,
  UNIQUE(release_id, platform)
);

-- Seed mortar game
INSERT INTO games (slug, name, description, github_repo)
VALUES ('mortar', 'Mortar', 'The Mortar game engine', 'contextgg/mortar')
ON CONFLICT (slug) DO NOTHING;
