-- Secure token storage with encrypted fields (text storing base64url strings)
create table if not exists public.oauth_tokens_secure (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google')),
  email text,
  id_token_enc text,
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.oauth_tokens_secure enable row level security;

-- attach audit trigger if not exists
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'tr_audit_oauth_tokens_secure' and tgenabled != 'D'
  ) then
    create trigger tr_audit_oauth_tokens_secure
      after insert or update or delete on public.oauth_tokens_secure
      for each row execute function public.fn_write_audit();
  end if;
end $$;

