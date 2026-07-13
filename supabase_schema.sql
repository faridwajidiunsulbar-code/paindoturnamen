-- ====================================================================
-- SUPABASE POSTGRESQL DATABASE SCHEMA FOR PICKLEBALL TOURNAMENT MANAGER
-- ====================================================================

-- Enable UUID generation (for profiles)
create extension if not exists "uuid-ossp";

-- 1. Profiles Table (Linked to Supabase Auth Users)
create table if not exists public.profiles (
    id uuid references auth.users on delete cascade primary key,
    full_name text,
    role text default 'admin' check (role in ('super_admin', 'admin', 'operator_score', 'viewer')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on profiles
alter table public.profiles enable row level security;

-- 2. Tournaments Table
create table if not exists public.tournaments (
    id text primary key, -- Use text to match frontend custom IDs
    owner_id uuid references public.profiles(id) on delete cascade not null,
    name text not null,
    date date not null,
    location text,
    status text default 'active' check (status in ('active', 'completed', 'archived')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on tournaments
alter table public.tournaments enable row level security;

-- 3. Match Types (Events, e.g., Ganda Putra, Single Putri)
create table if not exists public.match_types (
    id text primary key,
    tournament_id text references public.tournaments(id) on delete cascade not null,
    name text not null,
    format_type text default 'RR_KO' not null,
    gender_type text, -- 'Putra', 'Putri', 'Mix'
    is_double boolean default true not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on match_types
alter table public.match_types enable row level security;

-- 4. Age Groups (e.g., 19+, 35+, Open)
create table if not exists public.age_groups (
    id text primary key,
    tournament_id text references public.tournaments(id) on delete cascade not null,
    name text not null,
    min_age integer,
    is_open boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on age_groups
alter table public.age_groups enable row level security;

-- 5. Divisions Table (Active combination of Match Type & Age Group)
create table if not exists public.divisions (
    id text primary key,
    tournament_id text references public.tournaments(id) on delete cascade not null,
    match_type_id text references public.match_types(id) on delete cascade not null,
    age_group_id text references public.age_groups(id) on delete cascade not null,
    name text not null,
    is_active boolean default true not null,
    scoring_target integer default 15 not null,
    win_by_two boolean default true not null,
    group_size integer default 4 not null,
    qualifiers_per_group integer default 2 not null,
    knockout_size integer default 8 not null,
    wildcard_enabled boolean default false not null,
    bye_enabled boolean default false not null,
    status text default 'pending' check (status in ('pending', 'group_stage', 'knockout_stage', 'completed')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(tournament_id, match_type_id, age_group_id)
);

-- Enable RLS on divisions
alter table public.divisions enable row level security;

-- 6. Entries Table (Registered players/pairs)
create table if not exists public.entries (
    id text primary key,
    tournament_id text references public.tournaments(id) on delete cascade not null,
    division_id text references public.divisions(id) on delete cascade not null,
    player1_name text not null,
    player2_name text, -- NULL for singles
    club text,
    seed integer,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on entries
alter table public.entries enable row level security;

-- 7. Division Groups Table (Groups A, B, C etc in Round Robin)
create table if not exists public.division_groups (
    id text primary key,
    tournament_id text references public.tournaments(id) on delete cascade not null,
    division_id text references public.divisions(id) on delete cascade not null,
    name text not null, -- 'A', 'B', 'C', etc.
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on division_groups
alter table public.division_groups enable row level security;

-- 8. Group Members Table (Junction between groups and entries)
create table if not exists public.group_members (
    id text default gen_random_uuid()::text primary key,
    group_id text references public.division_groups(id) on delete cascade not null,
    entry_id text references public.entries(id) on delete cascade not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on group_members
alter table public.group_members enable row level security;

-- 9. Matches Table (Both Round Robin and Knockout matches)
create table if not exists public.matches (
    id text primary key,
    tournament_id text references public.tournaments(id) on delete cascade not null,
    division_id text references public.divisions(id) on delete cascade not null,
    group_id text references public.division_groups(id) on delete cascade, -- NULL for KO
    stage text not null check (stage in ('round_robin', 'knockout', 'bronze', 'final')),
    round text, -- e.g., 'Grup A', 'Perempat Final', 'Semifinal'
    match_no integer not null,
    entry_a_id text references public.entries(id) on delete set null,
    entry_b_id text references public.entries(id) on delete set null,
    score_a integer,
    score_b integer,
    winner_entry_id text references public.entries(id) on delete set null,
    loser_entry_id text references public.entries(id) on delete set null,
    status text default 'scheduled' check (status in ('scheduled', 'completed', 'walkover', 'cancelled')),
    is_walkover boolean default false not null,
    next_match_id text references public.matches(id) on delete set null, -- next round node in KO bracket
    bronze_match_id text references public.matches(id) on delete set null, -- optional bronze match reference
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on matches
alter table public.matches enable row level security;

-- 10. Knockout Slots Table (Records seeding/labels for the bracket)
create table if not exists public.knockout_slots (
    id text default gen_random_uuid()::text primary key,
    tournament_id text references public.tournaments(id) on delete cascade not null,
    division_id text references public.divisions(id) on delete cascade not null,
    seed_no integer not null,
    entry_id text references public.entries(id) on delete set null,
    source_label text, -- e.g., 'Juara Grup A', 'Runner-up Grup B'
    is_wildcard boolean default false not null,
    is_bye boolean default false not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on knockout_slots
alter table public.knockout_slots enable row level security;

-- 11. Champions Table (Division podium winners)
create table if not exists public.champions (
    id text primary key,
    tournament_id text references public.tournaments(id) on delete cascade not null,
    division_id text references public.divisions(id) on delete cascade not null unique,
    champion_entry_id text references public.entries(id) on delete set null,
    runner_up_entry_id text references public.entries(id) on delete set null,
    third_place_entry_id text references public.entries(id) on delete set null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on champions
alter table public.champions enable row level security;


-- ====================================================================
-- AUTOMATED USER PROFILE CREATION TRIGGER
-- ====================================================================

-- Function definition for handle_new_user_profile (must be run first in postgres)
create or replace function public.handle_new_user_profile()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'admin'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Automatically create a profile when a user signs up
create or replace trigger create_profile_on_signup
after insert on auth.users
for each row execute function public.handle_new_user_profile();


-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- Profiles Policies
create policy "Users can read all profiles" on public.profiles
    for select using (true);

create policy "Users can update their own profile" on public.profiles
    for update using (auth.uid() = id);

-- Tournaments Policies (Owned or created by authenticated user)
create policy "Users can read any tournament" on public.tournaments
    for select using (true); -- Publicly readable for spectators!

create policy "Users can insert their own tournaments" on public.tournaments
    for insert with check (auth.uid() = owner_id);

create policy "Users can update their own tournaments" on public.tournaments
    for update using (auth.uid() = owner_id);

create policy "Users can delete their own tournaments" on public.tournaments
    for delete using (auth.uid() = owner_id);

-- Helper functions for sub-table checks (checks owner_id of the parent tournament)
create or replace function public.is_tournament_owner(tournament_id_val text)
returns boolean as $$
begin
  return exists (
    select 1 from public.tournaments
    where id = tournament_id_val and owner_id = auth.uid()
  );
end;
$$ language plpgsql security definer;

-- Match Types Policies
create policy "Select match types" on public.match_types
    for select using (true); -- readable by everyone (needed for spectator/all views)

create policy "Insert match types" on public.match_types
    for insert with check (public.is_tournament_owner(tournament_id));

create policy "Update match types" on public.match_types
    for update using (public.is_tournament_owner(tournament_id));

create policy "Delete match types" on public.match_types
    for delete using (public.is_tournament_owner(tournament_id));

-- Age Groups Policies
create policy "Select age groups" on public.age_groups
    for select using (true);

create policy "Insert age groups" on public.age_groups
    for insert with check (public.is_tournament_owner(tournament_id));

create policy "Update age groups" on public.age_groups
    for update using (public.is_tournament_owner(tournament_id));

create policy "Delete age groups" on public.age_groups
    for delete using (public.is_tournament_owner(tournament_id));

-- Divisions Policies
create policy "Select divisions" on public.divisions
    for select using (true);

create policy "Insert divisions" on public.divisions
    for insert with check (public.is_tournament_owner(tournament_id));

create policy "Update divisions" on public.divisions
    for update using (public.is_tournament_owner(tournament_id));

create policy "Delete divisions" on public.divisions
    for delete using (public.is_tournament_owner(tournament_id));

-- Entries Policies
create policy "Select entries" on public.entries
    for select using (true);

create policy "Insert entries" on public.entries
    for insert with check (public.is_tournament_owner(tournament_id));

create policy "Update entries" on public.entries
    for update using (public.is_tournament_owner(tournament_id));

create policy "Delete entries" on public.entries
    for delete using (public.is_tournament_owner(tournament_id));

-- Division Groups Policies
create policy "Select division groups" on public.division_groups
    for select using (true);

create policy "Insert division groups" on public.division_groups
    for insert with check (public.is_tournament_owner(tournament_id));

create policy "Update division groups" on public.division_groups
    for update using (public.is_tournament_owner(tournament_id));

create policy "Delete division groups" on public.division_groups
    for delete using (public.is_tournament_owner(tournament_id));

-- Group Members Policies
create policy "Select group members" on public.group_members
    for select using (true);

-- To insert group members, check if we own the group's tournament
create policy "Insert group members" on public.group_members
    for insert with check (
        exists (
            select 1 from public.division_groups dg
            where dg.id = group_id and public.is_tournament_owner(dg.tournament_id)
        )
    );

create policy "Delete group members" on public.group_members
    for delete using (
        exists (
            select 1 from public.division_groups dg
            where dg.id = group_id and public.is_tournament_owner(dg.tournament_id)
        )
    );

-- Matches Policies
create policy "Select matches" on public.matches
    for select using (true);

create policy "Insert matches" on public.matches
    for insert with check (public.is_tournament_owner(tournament_id));

create policy "Update matches" on public.matches
    for update using (public.is_tournament_owner(tournament_id));

create policy "Delete matches" on public.matches
    for delete using (public.is_tournament_owner(tournament_id));

-- Knockout Slots Policies
create policy "Select knockout slots" on public.knockout_slots
    for select using (true);

create policy "Insert knockout slots" on public.knockout_slots
    for insert with check (public.is_tournament_owner(tournament_id));

create policy "Update knockout slots" on public.knockout_slots
    for update using (public.is_tournament_owner(tournament_id));

create policy "Delete knockout slots" on public.knockout_slots
    for delete using (public.is_tournament_owner(tournament_id));

-- Champions Policies
create policy "Select champions" on public.champions
    for select using (true);

create policy "Insert champions" on public.champions
    for insert with check (public.is_tournament_owner(tournament_id));

create policy "Update champions" on public.champions
    for update using (public.is_tournament_owner(tournament_id));

create policy "Delete champions" on public.champions
    for delete using (public.is_tournament_owner(tournament_id));
