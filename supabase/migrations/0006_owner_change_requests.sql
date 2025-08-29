-- Owner-facing change requests (stub schema for early trials)
create table if not exists public.owner_change_requests (
  id uuid primary key default gen_random_uuid(),
  location_id text,
  changes jsonb,
  status text default 'submitted',
  created_at timestamptz not null default now()
);

alter table public.owner_change_requests enable row level security;

