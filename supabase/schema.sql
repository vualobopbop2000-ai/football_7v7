-- Optional persistent lobby schema for a later Supabase-backed room directory.
-- The starter currently uses the authoritative Node.js server's in-memory rooms.
-- Do not expose service_role keys in the browser.

create extension if not exists pgcrypto;

create type public.match_status as enum ('waiting', 'countdown', 'playing', 'finished');

create table if not exists public.game_rooms (
  id text primary key,
  host_player_id text not null,
  status public.match_status not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_players (
  id text primary key,
  room_id text not null references public.game_rooms(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 18),
  team text not null check (team in ('red', 'blue')),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (room_id, id)
);

create index if not exists game_rooms_status_created_idx
  on public.game_rooms(status, created_at desc);
create index if not exists game_players_room_idx
  on public.game_players(room_id);

alter table public.game_rooms enable row level security;
alter table public.game_players enable row level security;

-- For production, mutate rooms and teams only through a trusted server / Edge Function.
-- Example read-only policies for a public lobby directory; tailor to your access model.
create policy "Anyone can read waiting rooms"
  on public.game_rooms for select
  using (status = 'waiting');

create policy "Anyone can read players in waiting rooms"
  on public.game_players for select
  using (exists (
    select 1 from public.game_rooms r
    where r.id = room_id and r.status = 'waiting'
  ));

-- Do not add unrestricted INSERT/UPDATE policies. Team balancing, ready state,
-- countdown, scoring and physics must be validated by the authoritative backend.
