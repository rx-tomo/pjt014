-- Minimal notifications table for audit/ops visibility
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  target text,
  subject text,
  body jsonb,
  status text default 'queued',
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

alter table public.notifications enable row level security;

-- Dev-friendly minimal policy: allow authenticated select
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (true);

