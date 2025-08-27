-- RLS policies and audit logging

-- Enable RLS on core tables (idempotent)
alter table if exists tenants enable row level security;
alter table if exists organizations enable row level security;
alter table if exists locations enable row level security;
alter table if exists change_requests enable row level security;
alter table if exists batches enable row level security;
alter table if exists sync_runs enable row level security;
alter table if exists memberships enable row level security;

-- Helper: check membership for an organization
create or replace function is_member_of_org(org_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from memberships m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
  );
$$;

-- Organizations: members can read; updates are restricted later (admin)
drop policy if exists org_select on organizations;
create policy org_select on organizations
for select using ( is_member_of_org(id) );

-- Locations: members of owning org can CRUD (tighten later)
drop policy if exists loc_all on locations;
create policy loc_all on locations
for all using ( is_member_of_org(organization_id) )
with check ( is_member_of_org(organization_id) );

-- Change Requests: members of the location's org can CRUD
drop policy if exists cr_all on change_requests;
create policy cr_all on change_requests
for all using (
  exists (
    select 1 from locations l
    where l.id = change_requests.location_id
      and is_member_of_org(l.organization_id)
  )
) with check (
  exists (
    select 1 from locations l
    where l.id = change_requests.location_id
      and is_member_of_org(l.organization_id)
  )
);

-- Batches: owner-only
drop policy if exists batches_owner on batches;
create policy batches_owner on batches
for all using ( created_by = auth.uid() )
with check ( created_by = auth.uid() );

-- Sync runs: visible if related location is visible OR own batches
drop policy if exists sync_runs_vis on sync_runs;
create policy sync_runs_vis on sync_runs
for select using (
  exists (
    select 1 from locations l
    where l.id = sync_runs.location_id
      and is_member_of_org(l.organization_id)
  )
  or exists (
    select 1 from batches b
    where b.id = sync_runs.batch_id
      and b.created_by = auth.uid()
  )
);

-- Tenants: visible if user belongs to any org under tenant
drop policy if exists tenants_vis on tenants;
create policy tenants_vis on tenants
for select using (
  exists (
    select 1 from organizations o
    join memberships m on m.organization_id = o.id
    where o.tenant_id = tenants.id
      and m.user_id = auth.uid()
  )
);

-- Memberships: users can see their own rows
drop policy if exists ms_read_own on memberships;
create policy ms_read_own on memberships
for select using ( user_id = auth.uid() );

-- Audit log table and triggers
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  table_name text not null,
  action text not null, -- INSERT/UPDATE/DELETE
  user_id uuid,
  row_id uuid,
  old_row jsonb,
  new_row jsonb
);

create or replace function audit_trigger_fn() returns trigger
language plpgsql as $$
declare
  v_user uuid := auth.uid();
begin
  if (TG_OP = 'INSERT') then
    insert into audit_log(table_name, action, user_id, row_id, new_row)
    values (TG_TABLE_NAME, TG_OP, v_user, NEW.id, row_to_json(NEW));
    return NEW;
  elsif (TG_OP = 'UPDATE') then
    insert into audit_log(table_name, action, user_id, row_id, old_row, new_row)
    values (TG_TABLE_NAME, TG_OP, v_user, NEW.id, row_to_json(OLD), row_to_json(NEW));
    return NEW;
  elsif (TG_OP = 'DELETE') then
    insert into audit_log(table_name, action, user_id, row_id, old_row)
    values (TG_TABLE_NAME, TG_OP, v_user, OLD.id, row_to_json(OLD));
    return OLD;
  end if;
  return null;
end;
$$;

-- Attach audit triggers (avoid highly sensitive tables like oauth_tokens by default)
do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_organizations'
  ) then
    create trigger audit_organizations after insert or update or delete on organizations
    for each row execute function audit_trigger_fn();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_locations'
  ) then
    create trigger audit_locations after insert or update or delete on locations
    for each row execute function audit_trigger_fn();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_change_requests'
  ) then
    create trigger audit_change_requests after insert or update or delete on change_requests
    for each row execute function audit_trigger_fn();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_batches'
  ) then
    create trigger audit_batches after insert or update or delete on batches
    for each row execute function audit_trigger_fn();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_sync_runs'
  ) then
    create trigger audit_sync_runs after insert or update or delete on sync_runs
    for each row execute function audit_trigger_fn();
  end if;
end $$;

