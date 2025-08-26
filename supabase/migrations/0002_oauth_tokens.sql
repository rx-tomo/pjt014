-- OAuth tokens persistence (dev-friendly; harden for prod)
create table if not exists oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  tokens jsonb not null,
  created_at timestamptz default now()
);

create index if not exists idx_oauth_tokens_provider_created_at
  on oauth_tokens(provider, created_at desc);

