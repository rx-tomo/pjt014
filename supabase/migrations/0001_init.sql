-- テナント/組織/ロケーション/会員/ロール
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  gbp_location_id text,
  place_id text,
  phone text,
  address jsonb,
  categories text[],
  opening_hours jsonb,
  labels text[],
  reservation_url text,
  meta jsonb,
  updated_at timestamptz default now()
);

create table if not exists users (
  id uuid primary key,
  email text,
  created_at timestamptz default now()
);

create table if not exists roles (
  key text primary key -- admin/operator/agency/clinic
);

create table if not exists memberships (
  user_id uuid references users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  role_key text references roles(key),
  primary key (user_id, organization_id)
);

create table if not exists change_requests (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  before jsonb,
  after jsonb,
  update_mask text[],
  status text default 'pending',
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_by uuid,
  status text default 'queued',
  created_at timestamptz default now()
);

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references batches(id) on delete set null,
  location_id uuid references locations(id) on delete set null,
  update_mask text[],
  request jsonb,
  response jsonb,
  status_code int,
  error text,
  created_at timestamptz default now()
);

-- RLS（雛形）
alter table tenants enable row level security;
alter table organizations enable row level security;
alter table locations enable row level security;

-- TODO: auth.uid() と memberships を用いたテナント境界の実装

