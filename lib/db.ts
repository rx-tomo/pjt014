import pg from 'pg';

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  // In dev, we allow absence; routes will check and return 500 with a message.
}

export const pool = new pg.Pool({
  connectionString,
  max: 5
});

export async function query<T = any>(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const res = await client.query<T>(text, params);
    return res;
  } finally {
    client.release();
  }
}

