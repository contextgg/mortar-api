# mortar-api

Backend API for the [ctx.gg](https://ctx.gg) platform.

**Hono** | **PostgreSQL** | **GitHub/Discord OAuth**

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your database and OAuth credentials

# Run database migrations
npm run db:migrate

# Start dev server
npm run dev
```

API runs at [http://localhost:3000](http://localhost:3000).

## API Routes

### Auth
- `GET /auth/github` — Start GitHub OAuth flow
- `GET /auth/discord` — Start Discord OAuth flow
- `GET /auth/me` — Get current user
- `POST /auth/logout` — Logout

### Maps
- `GET /api/maps` — List published maps (`?q=search&limit=20&offset=0`)
- `GET /api/maps/:slug` — Get map by slug
- `POST /api/maps` — Create map (auth required)
- `PUT /api/maps/:slug` — Update map (owner only)
- `DELETE /api/maps/:slug` — Delete map (owner only)
- `POST /api/maps/:slug/fork` — Fork a map (auth required)
- `POST /api/maps/:slug/like` — Toggle like (auth required)

### Users
- `GET /api/users/:username` — Get user profile with maps and stats

### Tournaments
- `GET /api/tournaments` — List tournaments (`?status=open`)
- `GET /api/tournaments/:id` — Get tournament with participants and matches
- `POST /api/tournaments` — Create tournament (auth required)
- `POST /api/tournaments/:id/join` — Join tournament (auth required)
- `POST /api/tournaments/:id/leave` — Leave tournament (auth required)

## Deployment

Deployed to [api.ctx.gg](https://api.ctx.gg) on Fly.io.

```bash
fly launch
fly postgres create
fly deploy
```

## License

MIT
