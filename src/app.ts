import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRoutes } from './routes/auth.js';
import { mapRoutes } from './routes/maps.js';
import { userRoutes } from './routes/users.js';
import { tournamentRoutes } from './routes/tournaments.js';
import { gameRoutes } from './routes/games.js';

export const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:1420',
    'https://editor.ctx.gg',
    'https://ctx.gg',
    'https://auth.ctx.gg',
    'tauri://localhost',
    'http://tauri.localhost',
  ],
  credentials: true,
}));

app.get('/', (c) => c.json({ name: 'mortar-api', version: '0.1.0' }));
app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/auth', authRoutes);
app.route('/api/maps', mapRoutes);
app.route('/api/users', userRoutes);
app.route('/api/tournaments', tournamentRoutes);
app.route('/api/games', gameRoutes);
