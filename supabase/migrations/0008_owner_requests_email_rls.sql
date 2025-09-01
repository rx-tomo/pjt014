-- Add owner identity and RLS policies for owner_change_requests
alter table if exists public.owner_change_requests
  add column if not exists created_by_email text;

-- Helpful index when filtering by creator
create index if not exists idx_owner_change_requests_created_by_email
  on public.owner_change_requests (created_by_email);

-- Ensure RLS is enabled (should already be)
alter table if exists public.owner_change_requests enable row level security;

-- Policies: allow authenticated users to manage only their own rows
drop policy if exists owner_change_requests_select on public.owner_change_requests;
drop policy if exists owner_change_requests_insert on public.owner_change_requests;
drop policy if exists owner_change_requests_update on public.owner_change_requests;

create policy owner_change_requests_select on public.owner_change_requests
  for select
  to authenticated
  using (auth.jwt() ->> 'email' = created_by_email);

create policy owner_change_requests_insert on public.owner_change_requests
  for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = created_by_email);

create policy owner_change_requests_update on public.owner_change_requests
  for update
  to authenticated
  using (auth.jwt() ->> 'email' = created_by_email)
  with check (auth.jwt() ->> 'email' = created_by_email);

