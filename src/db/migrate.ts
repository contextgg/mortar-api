import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { sql } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await sql.unsafe(schema);
  console.log('Migration complete');
  await sql.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
