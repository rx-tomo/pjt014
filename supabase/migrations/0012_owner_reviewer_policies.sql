-- Reviewer/Admin policies to allow review operations via JWT role claims
-- Note: service_role bypasses RLS; these policies matter when using end-user tokens.

-- Ensure RLS remains enabled
alter table if exists public.owner_change_requests enable row level security;
alter table if exists public.audit_logs enable row level security;

-- Change Requests: reviewer/admin can read/update all rows (owners limited by their email in 0008)
drop policy if exists owner_change_requests_reviewer_select on public.owner_change_requests;
create policy owner_change_requests_reviewer_select on public.owner_change_requests
  for select to authenticated
  using (coalesce(auth.jwt() ->> 'role','') in ('reviewer','admin'));

drop policy if exists owner_change_requests_reviewer_update on public.owner_change_requests;
create policy owner_change_requests_reviewer_update on public.owner_change_requests
  for update to authenticated
  using (coalesce(auth.jwt() ->> 'role','') in ('reviewer','admin'))
  with check (coalesce(auth.jwt() ->> 'role','') in ('reviewer','admin'));

-- Audit Logs: reviewer/admin can read all logs
drop policy if exists audit_logs_reviewer_select on public.audit_logs;
create policy audit_logs_reviewer_select on public.audit_logs
  for select to authenticated
  using (coalesce(auth.jwt() ->> 'role','') in ('reviewer','admin'));

