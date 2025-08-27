-- add refresh token and expiry tracking
alter table oauth_tokens
  add column refresh_token text,
  add column expires_at timestamptz;

-- backfill expires_at from stored tokens if present
update oauth_tokens
set expires_at = to_timestamp((tokens->>'expiry_date')::bigint / 1000)
where tokens ? 'expiry_date' and expires_at is null;
