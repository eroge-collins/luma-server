-- =============================================
-- LUMA Database Schema
-- =============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- =============================================
-- PROFILES TABLE
-- =============================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  status text default 'offline' check (status in ('online', 'offline', 'busy')),
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.profiles enable row level security;

-- Profiles policies
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- =============================================
-- CHANNELS TABLE
-- =============================================
create table if not exists public.channels (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type text not null check (type in ('text', 'voice')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.channels enable row level security;

-- Channel policies
create policy "Channels are viewable by everyone"
  on public.channels for select
  using (true);

create policy "Authenticated users can create channels"
  on public.channels for insert
  with check (auth.role() = 'authenticated');

create policy "Channel creators can update their channels"
  on public.channels for update
  using (auth.uid() = created_by);

create policy "Channel creators can delete their channels"
  on public.channels for delete
  using (auth.uid() = created_by);

-- =============================================
-- MESSAGES TABLE
-- =============================================
create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.messages enable row level security;

-- Messages policies
create policy "Messages are viewable by everyone"
  on public.messages for select
  using (true);

create policy "Authenticated users can insert messages"
  on public.messages for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own messages"
  on public.messages for update
  using (auth.uid() = user_id);

create policy "Users can delete their own messages"
  on public.messages for delete
  using (auth.uid() = user_id);

-- =============================================
-- VOICE SESSIONS TABLE
-- =============================================
create table if not exists public.voice_sessions (
  id uuid primary key default uuid_generate_v4(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  signal_data jsonb,
  created_at timestamptz default now(),
  unique(channel_id, user_id)
);

-- Enable RLS
alter table public.voice_sessions enable row level security;

-- Voice sessions policies
create policy "Voice sessions are viewable by everyone"
  on public.voice_sessions for select
  using (true);

create policy "Authenticated users can insert voice sessions"
  on public.voice_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own voice sessions"
  on public.voice_sessions for update
  using (auth.uid() = user_id);

create policy "Users can delete their own voice sessions"
  on public.voice_sessions for delete
  using (auth.uid() = user_id);

-- =============================================
-- ENABLE REALTIME
-- =============================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.voice_sessions;
alter publication supabase_realtime add table public.channels;

-- =============================================
-- CREATE DEFAULT CHANNELS
-- =============================================
-- We'll create default channels without a creator
insert into public.channels (name, type) values
  ('general', 'text'),
  ('random', 'text'),
  ('voice-chat', 'voice'),
  ('music', 'voice')
on conflict do nothing;
