import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/mortar';

export const sql = postgres(databaseUrl);
