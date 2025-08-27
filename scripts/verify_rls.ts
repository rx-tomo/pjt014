#!/usr/bin/env -S tsx
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anon = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const testJwt = process.env.SUPABASE_TEST_JWT; // optional user access token

  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'RLS verify start' }));

  const anonClient = createClient(url, anon);
  // Anonymous: try reading organizations count (should be 0 if RLS blocks)
  {
    const { count, error } = await anonClient
      .from('organizations')
      .select('*', { count: 'exact', head: true });
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: error ? 'warn' : 'info',
        msg: 'anon organizations count',
        count,
        error: error?.message
      })
    );
  }

  if (testJwt) {
    // Authenticated user context via bearer token
    const authed = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${testJwt}` } }
    });

    const [{ count: orgCount, error: orgErr }, { data: ms, error: msErr }] = await Promise.all([
      authed.from('organizations').select('*', { count: 'exact', head: true }),
      authed.from('memberships').select('organization_id, user_id').limit(5)
    ]);

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: orgErr ? 'warn' : 'info',
        msg: 'authed organizations count',
        count: orgCount,
        error: orgErr?.message
      })
    );
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: msErr ? 'warn' : 'info',
        msg: 'memberships sample',
        rows: ms?.length ?? 0
      })
    );
  } else {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        msg: 'SUPABASE_TEST_JWT not set; run anon-only checks'
      })
    );
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'RLS verify end' }));
}

main().catch((e) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'verify failed', error: (e as Error).message }));
  process.exit(1);
});

