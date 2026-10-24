-- DNKI SHARKS Digital Accreditation Platform — foundation schema
-- All timestamps are timestamptz. Monetary values are bigint minor units.

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Identity, sessions, RBAC
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  full_name text not null check (length(full_name) between 2 and 160),
  phone text,
  password_hash text not null,
  email_verified_at timestamptz,
  status text not null default 'active' check (status in ('active', 'suspended', 'disabled')),
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  mfa_secret_enc text,
  mfa_enabled_at timestamptz,
  mfa_last_timestep bigint,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index mfa_recovery_codes_user_idx on mfa_recovery_codes (user_id) where used_at is null;

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  mfa_verified_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  ip inet,
  user_agent text
);
create index sessions_user_active_idx on sessions (user_id) where revoked_at is null;

create table one_time_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete cascade,
  purpose text not null check (purpose in ('email_verification', 'password_reset', 'membership_contact')),
  code_hash text not null,
  subject_id uuid,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index one_time_codes_lookup_idx on one_time_codes (user_id, purpose) where consumed_at is null;
create unique index one_time_codes_reset_hash_idx on one_time_codes (code_hash) where purpose = 'password_reset';

create table roles (
  key text primary key,
  name text not null,
  privileged boolean not null
);

create table permissions (
  key text primary key,
  description text not null
);

create table role_permissions (
  role_key text not null references roles (key) on delete cascade,
  permission_key text not null references permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table user_roles (
  user_id uuid not null references users (id) on delete cascade,
  role_key text not null references roles (key),
  granted_by uuid references users (id),
  granted_at timestamptz not null default now(),
  reason text,
  primary key (user_id, role_key)
);

-- ---------------------------------------------------------------------------
-- Append-only administrative audit log
-- ---------------------------------------------------------------------------

create table administrative_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references users (id),
  actor_roles text[] not null default '{}',
  action text not null,
  entity_type text not null,
  entity_id text,
  reason text,
  correlation_id text,
  ip inet,
  metadata jsonb not null default '{}'::jsonb
);
create index audit_entity_idx on administrative_audit_events (entity_type, entity_id);
create index audit_actor_idx on administrative_audit_events (actor_user_id, occurred_at desc);
create index audit_time_idx on administrative_audit_events (occurred_at desc);

create function forbid_audit_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'administrative_audit_events is append-only';
end;
$$;
create trigger audit_no_update before update or delete on administrative_audit_events
  for each row execute function forbid_audit_mutation();
create trigger audit_no_truncate before truncate on administrative_audit_events
  for each statement execute function forbid_audit_mutation();

-- ---------------------------------------------------------------------------
-- Event configuration
-- ---------------------------------------------------------------------------

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  theme text not null default '',
  description text not null default '',
  venue_text text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Africa/Lagos',
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  registration_open boolean not null default false,
  reentry_policy text not null default 'single_entry' check (reentry_policy in ('single_entry', 'reentry_allowed')),
  credential_valid_from timestamptz,
  credential_valid_until timestamptz,
  support_email text,
  support_phone text,
  privacy_notice text not null default '',
  terms text not null default '',
  faqs jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index events_single_active_idx on events (is_active) where is_active;

create table event_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  description text not null default '',
  created_at timestamptz not null default now()
);
create index event_sessions_event_idx on event_sessions (event_id, starts_at);

create table registration_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  fee_minor bigint not null check (fee_minor > 0),
  currency char(3) not null,
  capacity integer check (capacity is null or capacity > 0),
  requires_identity_check boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, code)
);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  title text not null,
  body text not null default '',
  kind text not null check (kind in ('announcement', 'facebook_broadcast', 'link')),
  url text check (url is null or url like 'https://%'),
  visibility text not null default 'public' check (visibility = 'public'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index announcements_public_idx on announcements (event_id, published_at desc) where status = 'published';

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references users (id),
  filename text not null,
  status text not null check (status in ('validated', 'applied', 'rejected')),
  total_rows integer not null,
  valid_rows integer not null,
  error_rows integer not null,
  errors jsonb not null default '[]'::jsonb,
  staged_rows jsonb,
  applied_by uuid references users (id),
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create table member_records (
  id uuid primary key default gen_random_uuid(),
  membership_number text not null unique,
  full_name text not null,
  chapter text not null default '',
  zone text not null default '',
  email citext,
  phone text,
  standing text not null check (standing in ('good_standing', 'lapsed', 'suspended', 'expelled')),
  source text not null check (source in ('import', 'api', 'manual')),
  import_job_id uuid references import_jobs (id),
  linked_user_id uuid unique references users (id),
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index member_records_email_idx on member_records (email);
create index member_records_name_idx on member_records (lower(full_name) text_pattern_ops);

create table membership_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  membership_number_submitted text not null,
  contact_submitted text,
  member_record_id uuid references member_records (id),
  method text not null check (method in ('registry_contact_code', 'api_contact_code', 'manual_review')),
  provider text not null,
  status text not null check (status in ('pending_contact', 'pending_review', 'approved', 'rejected', 'expired', 'superseded')),
  submitted_note text,
  decision_reason text,
  decided_by uuid references users (id),
  decided_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index membership_verifications_one_open_idx
  on membership_verifications (user_id) where status in ('pending_contact', 'pending_review');
create unique index membership_verifications_one_approved_idx
  on membership_verifications (user_id) where status = 'approved';
create index membership_verifications_queue_idx on membership_verifications (status, created_at);

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

create table registrations (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  event_id uuid not null references events (id),
  category_id uuid not null references registration_categories (id),
  user_id uuid not null references users (id),
  member_record_id uuid not null references member_records (id),
  status text not null check (status in ('awaiting_payment', 'paid', 'accredited', 'cancelled', 'refunded', 'suspended', 'revoked')),
  fee_minor bigint not null check (fee_minor > 0),
  currency char(3) not null,
  terms_accepted_at timestamptz not null,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index registrations_one_per_member_idx on registrations (event_id, member_record_id)
  where status not in ('cancelled', 'refunded');
create unique index registrations_one_per_user_idx on registrations (event_id, user_id)
  where status not in ('cancelled', 'refunded');
create index registrations_status_idx on registrations (event_id, status, created_at);
create index registrations_category_idx on registrations (category_id, status);

create table registration_status_history (
  id bigint generated always as identity primary key,
  registration_id uuid not null references registrations (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_type text not null check (actor_type in ('participant', 'staff', 'system')),
  actor_user_id uuid references users (id),
  reason text,
  created_at timestamptz not null default now()
);
create index registration_status_history_reg_idx on registration_status_history (registration_id, created_at);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table payment_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  registration_id uuid not null references registrations (id),
  provider text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null check (status in ('initiated', 'pending', 'succeeded', 'failed', 'abandoned', 'refunded', 'disputed', 'needs_review')),
  checkout_url text,
  provider_access_code text,
  provider_transaction_id text,
  failure_reason text,
  expires_at timestamptz not null,
  succeeded_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payment_orders_one_open_idx on payment_orders (registration_id) where status in ('initiated', 'pending');
create unique index payment_orders_one_success_idx on payment_orders (registration_id) where status in ('succeeded', 'refunded', 'disputed');
create index payment_orders_reconcile_idx on payment_orders (status, created_at);

create table payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references payment_orders (id),
  provider text not null,
  provider_transaction_id text not null,
  status text not null,
  amount_minor bigint not null,
  currency char(3) not null,
  channel text,
  paid_at timestamptz,
  verification_source text not null check (verification_source in ('webhook', 'status_check', 'reconciliation')),
  verified_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);
create index payment_transactions_order_idx on payment_transactions (order_id);

create table payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  dedupe_key text not null,
  signature_valid boolean not null,
  event_type text,
  reference text,
  payload jsonb,
  processing_status text not null check (processing_status in ('received', 'processed', 'ignored', 'failed', 'rejected')),
  error text,
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, dedupe_key)
);
create index payment_webhook_events_ref_idx on payment_webhook_events (reference);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references payment_orders (id),
  registration_id uuid not null references registrations (id),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null check (status in ('requested', 'processing', 'completed', 'failed')),
  reason text not null,
  requested_by uuid not null references users (id),
  provider_refund_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index refunds_one_active_idx on refunds (order_id) where status in ('requested', 'processing', 'completed');

-- Backing store for the SANDBOX mock payment provider. Never used by real providers.
create table sandbox_mock_payments (
  reference text primary key,
  transaction_id text not null unique,
  amount_minor bigint not null,
  currency char(3) not null,
  status text not null check (status in ('pending', 'success', 'failed', 'reversed')),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Accreditation and venue access
-- ---------------------------------------------------------------------------

create table gates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, code)
);

create table scanner_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  gate_id uuid not null references gates (id),
  registered_by uuid not null references users (id),
  is_active boolean not null default true,
  last_seen_at timestamptz,
  last_user_id uuid references users (id),
  created_at timestamptz not null default now()
);

create table scanner_gate_assignments (
  user_id uuid not null references users (id) on delete cascade,
  gate_id uuid not null references gates (id) on delete cascade,
  assigned_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  primary key (user_id, gate_id)
);

create table accreditation_credentials (
  id uuid primary key default gen_random_uuid(),
  accreditation_id text not null unique,
  token_hash text not null unique,
  token_enc text not null,
  registration_id uuid not null references registrations (id),
  user_id uuid not null references users (id),
  event_id uuid not null references events (id),
  status text not null check (status in ('active', 'revoked', 'superseded', 'suspended')),
  issued_at timestamptz not null default now(),
  valid_from timestamptz,
  valid_until timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references users (id),
  revocation_reason text,
  replaces_id uuid references accreditation_credentials (id),
  admitted_at timestamptz,
  admitted_gate_id uuid references gates (id),
  presence text not null default 'outside' check (presence in ('outside', 'inside')),
  last_scan_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index accreditation_one_active_idx on accreditation_credentials (registration_id) where status = 'active';
create index accreditation_user_idx on accreditation_credentials (user_id);
create index accreditation_event_status_idx on accreditation_credentials (event_id, status);

create table credential_events (
  id bigint generated always as identity primary key,
  credential_id uuid not null references accreditation_credentials (id),
  event_type text not null check (event_type in ('issued', 'revoked', 'reissued', 'superseded', 'suspended', 'reinstated', 'admitted', 'override_admitted')),
  actor_user_id uuid references users (id),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index credential_events_cred_idx on credential_events (credential_id, created_at);

create table attendance_events (
  id bigint generated always as identity primary key,
  event_id uuid not null references events (id),
  credential_id uuid references accreditation_credentials (id),
  gate_id uuid not null references gates (id),
  device_id uuid not null references scanner_devices (id),
  scanned_by uuid not null references users (id),
  method text not null check (method in ('qr', 'manual_lookup', 'override')),
  direction text not null check (direction in ('entry', 'exit')),
  result text not null,
  counted boolean not null default false,
  override_reason text,
  correlation_id text,
  created_at timestamptz not null default now()
);
create index attendance_gate_time_idx on attendance_events (gate_id, created_at desc);
create index attendance_credential_idx on attendance_events (credential_id, created_at);
create index attendance_event_result_idx on attendance_events (event_id, result);

create table security_incidents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id),
  gate_id uuid references gates (id),
  credential_id uuid references accreditation_credentials (id),
  reported_by uuid not null references users (id),
  category text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  description text not null,
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved')),
  resolution text,
  resolved_by uuid references users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index security_incidents_status_idx on security_incidents (event_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications (durable outbox)
-- ---------------------------------------------------------------------------

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp')),
  template text not null,
  recipient text not null,
  subject text not null,
  body_text text not null,
  sensitive boolean not null default false,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_due_idx on notifications (next_attempt_at) where status in ('pending', 'sending');

-- Development-only inbox written by the "log" email adapter in demo mode.
create table dev_mailbox (
  id bigint generated always as identity primary key,
  recipient text not null,
  subject text not null,
  body_text text not null,
  created_at timestamptz not null default now()
);
