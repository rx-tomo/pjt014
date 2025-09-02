-- Audit logs for key actions (change requests etc.)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id text not null,
  action text not null,
  actor_email text,
  meta jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

-- RLS: allow actors to see their own records by default (dev-friendly minimal policy)
drop policy if exists audit_logs_select on public.audit_logs;
drop policy if exists audit_logs_insert on public.audit_logs;

create policy audit_logs_select on public.audit_logs
  for select
  to authenticated
  using (actor_email is null or auth.jwt() ->> 'email' = actor_email);

create policy audit_logs_insert on public.audit_logs
  for insert
  to authenticated
  with check (actor_email is null or auth.jwt() ->> 'email' = actor_email);

