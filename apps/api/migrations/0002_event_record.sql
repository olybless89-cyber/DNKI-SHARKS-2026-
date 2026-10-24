-- The single event this platform serves. Only the facts supplied by DNKI are set;
-- dates, venue, fees, programme and legal texts are configured by an Event
-- Administrator in the admin interface. Registration starts closed.
insert into events (slug, name, theme, description, registration_open, is_active)
values (
  'sharks-international-convergence',
  'SHARKS International Convergence',
  'REBUILDING THE BROTHERHOOD',
  '',
  false,
  true
)
on conflict (slug) do nothing;
