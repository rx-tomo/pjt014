-- Add review checks and owner signoff to owner_change_requests
alter table if exists public.owner_change_requests
  add column if not exists checks jsonb,
  add column if not exists owner_signoff boolean not null default false;

