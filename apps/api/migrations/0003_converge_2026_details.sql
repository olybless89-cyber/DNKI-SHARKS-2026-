-- Official details published by DNKI on dnkiconvergeportal.com (October 2026):
-- the 18th DNKI Converge, "SHARKS 2026 International Converge", Thursday 10 to
-- Sunday 13 December 2026, accreditation contacts, and the delegate registration
-- fields (patrol, designation, meals, declarations). Everything here remains
-- editable by an Event Administrator.

alter table events
  add column edition text not null default '',
  add column contacts jsonb not null default '[]'::jsonb;

update events
   set name = 'SHARKS 2026 International Converge',
       edition = 'The 18th DNKI Converge',
       theme = 'Rebuilding the Brotherhood, Empowering Our Future',
       starts_at = coalesce(starts_at, '2026-12-10T00:00:00+01:00'),
       ends_at = coalesce(ends_at, '2026-12-13T23:59:00+01:00'),
       contacts = '[
         {"role": "Director, Accreditation", "name": "Hon. Azulo Solomon", "phone": "+234 703 670 5032"},
         {"role": "Skull Pilot Team", "name": "Hon. Bern Atavi", "phone": "0813 630 1662"}
       ]'::jsonb,
       updated_at = now()
 where slug = 'sharks-international-convergence';

-- Configurable choice lists for the registration form.
create table registration_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  kind text not null check (kind in ('patrol', 'designation', 'meal_friday', 'meal_saturday')),
  label text not null check (length(label) between 1 and 120),
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, kind, label)
);

insert into registration_options (event_id, kind, label, sort)
select e.id, v.kind, v.label, v.sort
  from events e
 cross join (
   select 'designation' as kind, label, ord::int as sort
     from unnest(array['FF', 'PAC', 'Bot Member', 'NEC', 'Sailyn Council', 'Deckhand']) with ordinality as t(label, ord)
   union all
   select k.kind, m.label, m.ord::int
     from (values ('meal_friday'), ('meal_saturday')) as k(kind)
    cross join unnest(array[
      'Jollof Rice/Fried Rice with Salad & Chicken',
      'Afang Soup with Fufu/Garri',
      'Egusi Soup with Fufu/Garri',
      'Okro Soup with Fufu/Garri'
    ]) with ordinality as m(label, ord)
   union all
   select 'patrol', label, ord::int
     from unnest(array[
      'Adaka MP', 'Akendzilina MP', 'Alamenia MP', 'Apartheid MP', 'Arabian Treasure MP', 'Aso MP', 'Atatuk MP',
      'Atlantic MP', 'Bangolina MP', 'Belcentral MP', 'Bismack MP', 'Britannia MP', 'BUNDES MP', 'Cambodiana MP',
      'Chilango MP', 'Coalina MP', 'Damaga MP', 'Emirates MP', 'Faso MP', 'Frigate MP', 'Germania MP', 'GODZILLA MP',
      'H20 MP', 'Harambee MP', 'HEARTS MP', 'Hongkonglina MP', 'Indian Treasure MP', 'Indocatlina Treasure MP',
      'Kadaz MP', 'Kenem MP', 'Kingdom MP', 'Lumen MP', 'Malayina MP', 'Mediterranean MP', 'Nipponlina MP',
      'Perkings MP', 'Philiana Treasure MP', 'Rumfalina', 'Russ MP', 'Sahara MP', 'Salt MP', 'Sea Eagle MP',
      'Senelina MP', 'Sharks MP', 'Shoreguard MP', 'Sicily MP', 'Snotra MP', 'Snow Mountain MP', 'Solis MP',
      'St. Bensaga MP', 'St. Catalina MP', 'St. Indiana MP', 'St. Oseberg', 'St. Saratoga MP', 'St. Tantacola MP',
      'St. Thailando MP', 'Sultanate MP', 'Thorsberg MP', 'Treasure MP', 'Treasure Gate MP', 'Utterlina MP',
      'Varangians MP', 'Vatican MP', 'Viet MP', 'Zilona MP', 'Zumalina MP'
     ]) with ordinality as t(label, ord)
 ) as v
 where e.slug = 'sharks-international-convergence'
on conflict do nothing;

-- Delegate details captured at registration. Nullable for rows created before
-- this migration; the API requires them for new registrations.
alter table registrations
  add column norish_name text,
  add column norsical_name text,
  add column patrol_option_id uuid references registration_options (id),
  add column designation_option_id uuid references registration_options (id),
  add column meal_friday_option_id uuid references registration_options (id),
  add column meal_saturday_option_id uuid references registration_options (id),
  add column hard_drugs_declaration text check (hard_drugs_declaration in ('yes', 'no')),
  add column conduct_rules_accepted_at timestamptz;

create index registrations_patrol_idx on registrations (patrol_option_id);

-- Passport photographs for gate identity confirmation. Visible only to the
-- participant and to staff with scanning or credential permissions.
create table participant_photos (
  user_id uuid primary key references users (id) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 2097152),
  sha256 text not null,
  uploaded_at timestamptz not null default now()
);
