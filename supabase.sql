-- SCHEMA -----------------------------------------------------------
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  title text default '',
  avatar_url text default '',
  role text check (role in ('admin','member')) default 'member',
  created_at timestamptz default now()
);

create table if not exists accursed (
  id bigserial primary key,
  username text not null,
  avatar_url text not null,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists submissions (
  id bigserial primary key,
  target_username text not null,
  target_avatar_url text not null,
  reason text not null,
  status text check (status in ('pending','accepted','rejected')) default 'pending',
  created_at timestamptz default now()
);

-- REALTIME ---------------------------------------------------------
alter publication supabase_realtime add table accursed;
alter publication supabase_realtime add table submissions;

-- RLS --------------------------------------------------------------
alter table profiles enable row level security;
alter table accursed enable row level security;
alter table submissions enable row level security;

-- profiles: users can read their own profile; admins can read all
create policy if not exists "profiles self or admin read" on profiles
for select using (
  auth.uid() = user_id
  or exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'admin')
);

-- accursed: only authenticated users can read; only admins can write
create policy if not exists "accursed read auth" on accursed
for select using ( auth.role() = 'authenticated' );

create policy if not exists "accursed write admin" on accursed
for all using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role='admin')
) with check (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role='admin')
);

-- submissions: anyone (even anon) can insert; only admins can see/update
create policy if not exists "submissions insert public" on submissions
for insert with check ( true );

create policy if not exists "submissions read admin" on submissions
for select using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role='admin')
);

create policy if not exists "submissions update admin" on submissions
for update using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role='admin')
) with check (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role='admin')
);

create policy if not exists "submissions delete admin" on submissions
for delete using (
  exists (select 1 from profiles p where p.user_id = auth.uid() and p.role='admin')
);

-- Add helpful indexes
create index if not exists accursed_created_at_idx on accursed(created_at desc);
create index if not exists submissions_status_idx on submissions(status, created_at desc);