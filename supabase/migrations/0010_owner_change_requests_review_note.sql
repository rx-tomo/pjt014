-- Add review_note to owner_change_requests for reviewer comments
alter table if exists public.owner_change_requests
  add column if not exists review_note text;

