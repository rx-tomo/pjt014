-- Add fields for secure refresh handling
alter table oauth_tokens
  add column if not exists user_id uuid,
  add column if not exists encrypted_refresh_token bytea,
  add column if not exists expires_at timestamptz;

create index if not exists idx_oauth_tokens_user_created
  on oauth_tokens(user_id, created_at desc);

