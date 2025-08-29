-- OAuth tokens storage (secure and json snapshot)
-- Requires: pgcrypto for gen_random_uuid()

create extension if not exists pgcrypto;

-- Encrypted-at-rest table (application handles encryption)
create table if not exists public.oauth_tokens_secure (
  id uuid primary key default gen_random_uuid(),
  provider text not null, -- e.g., 'google'
  email text,             -- user email for quick lookup
  id_token_enc text,      -- AES-GCM ciphertext (base64 or hex)
  access_token_enc text,  -- AES-GCM ciphertext
  refresh_token_enc text, -- AES-GCM ciphertext
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- JSON snapshot table for debugging/analytics (no secrets if avoidable)
create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  provider text not null, -- e.g., 'google'
  tokens jsonb not null,  -- { email, id_token?, access_token?, refresh_token?, expires_at }
  created_at timestamptz default now()
);

-- Basic indexes for lookup
create index if not exists idx_oauth_tokens_secure_email_created_at
  on public.oauth_tokens_secure (email, created_at desc);

create index if not exists idx_oauth_tokens_provider_created_at
  on public.oauth_tokens (provider, created_at desc);

-- RLS policy: disabled for now; access via service role only in dev
alter table public.oauth_tokens_secure disable row level security;
alter table public.oauth_tokens disable row level security;

