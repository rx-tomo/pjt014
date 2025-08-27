-- RLS & AUDIT: 本番前提の最小実装
-- 方針:
-- 1) oauth_tokens は極めて秘匿性が高いため、RLS有効化 + ポリシー未付与（= すべて拒否）
--    サーバ側（service_role）はRLSをバイパスするため、APIサーバからのみ操作可能。
-- 2) 監査ログ audit_log を作成し、主要テーブル（oauth_tokens/tenants/organizations/locations）への
--    INSERT/UPDATE/DELETE を記録。

-- 1) RLS: oauth_tokens を完全閉鎖（service_role 経由のみ利用）
alter table if exists public.oauth_tokens enable row level security;
-- ポリシーは追加しない（= anon/authenticated からは一切の操作不可）

-- 2) 監査ログ: 汎用トリガー
create table if not exists public.audit_log (
  id bigserial primary key,
  table_name text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  row_pk text,
  old_data jsonb,
  new_data jsonb,
  actor uuid,
  request_id text,
  created_at timestamptz not null default now()
);

create or replace function public.fn_write_audit() returns trigger as $$
declare
  v_pk text;
  v_actor uuid := auth.uid();
  v_req text := null; -- 必要なら request_id をアプリ側から GUC で渡す
begin
  -- 主キー推定（共通カラム id がある前提。なければ null）
  if (TG_OP = 'INSERT') then
    begin v_pk := (NEW).id::text; exception when others then v_pk := null; end;
    insert into public.audit_log(table_name, action, row_pk, old_data, new_data, actor, request_id)
    values (TG_TABLE_NAME, TG_OP, v_pk, null, to_jsonb(NEW), v_actor, v_req);
    return NEW;
  elsif (TG_OP = 'UPDATE') then
    begin v_pk := (NEW).id::text; exception when others then v_pk := null; end;
    insert into public.audit_log(table_name, action, row_pk, old_data, new_data, actor, request_id)
    values (TG_TABLE_NAME, TG_OP, v_pk, to_jsonb(OLD), to_jsonb(NEW), v_actor, v_req);
    return NEW;
  elsif (TG_OP = 'DELETE') then
    begin v_pk := (OLD).id::text; exception when others then v_pk := null; end;
    insert into public.audit_log(table_name, action, row_pk, old_data, new_data, actor, request_id)
    values (TG_TABLE_NAME, TG_OP, v_pk, to_jsonb(OLD), null, v_actor, v_req);
    return OLD;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

-- 監査対象テーブルにトリガーを設定（存在しない場合のみ）
do $$
begin
  if to_regclass('public.oauth_tokens') is not null and not exists (
    select 1 from pg_trigger where tgname = 'tr_audit_oauth_tokens' and tgenabled != 'D'
  ) then
    create trigger tr_audit_oauth_tokens
      after insert or update or delete on public.oauth_tokens
      for each row execute function public.fn_write_audit();
  end if;

  if to_regclass('public.tenants') is not null and not exists (
    select 1 from pg_trigger where tgname = 'tr_audit_tenants' and tgenabled != 'D'
  ) then
    create trigger tr_audit_tenants
      after insert or update or delete on public.tenants
      for each row execute function public.fn_write_audit();
  end if;

  if to_regclass('public.organizations') is not null and not exists (
    select 1 from pg_trigger where tgname = 'tr_audit_organizations' and tgenabled != 'D'
  ) then
    create trigger tr_audit_organizations
      after insert or update or delete on public.organizations
      for each row execute function public.fn_write_audit();
  end if;

  if to_regclass('public.locations') is not null and not exists (
    select 1 from pg_trigger where tgname = 'tr_audit_locations' and tgenabled != 'D'
  ) then
    create trigger tr_audit_locations
      after insert or update or delete on public.locations
      for each row execute function public.fn_write_audit();
  end if;
end $$;

