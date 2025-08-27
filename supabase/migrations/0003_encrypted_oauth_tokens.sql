-- Add user_id and encrypted_tokens, drop plain tokens
alter table oauth_tokens
  add column if not exists user_id uuid,
  add column if not exists encrypted_tokens bytea;

alter table oauth_tokens
  drop column if exists tokens;

create index if not exists idx_oauth_tokens_user_id_created_at
  on oauth_tokens(user_id, created_at desc);
