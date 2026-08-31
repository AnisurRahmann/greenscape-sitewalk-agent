-- 0001_init.sql — initial schema for the Greenscape site-walk proposal agent.
-- Requires: pgvector (embedding + HNSW) and pg_trgm (fuzzy SKU matching).

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table if not exists catalog_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  category text not null,
  name text not null,
  description text,
  unit text not null check (unit in ('sqft', 'lf', 'ea', 'hr', 'day')),
  unit_price numeric not null,
  unit_cost numeric not null,
  min_qty numeric not null default 0,
  notes text,
  embedding vector(1536),
  search_tsv tsvector generated always as (
    to_tsvector('english', name || ' ' || coalesce(description, '') || ' ' || category)
  ) stored
);

create index if not exists catalog_items_embedding_hnsw
  on catalog_items using hnsw (embedding vector_cosine_ops);

create index if not exists catalog_items_search_tsv_gin
  on catalog_items using gin (search_tsv);

create index if not exists catalog_items_name_trgm_gin
  on catalog_items using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Pipeline: lead -> site walk -> extraction -> proposal
-- ---------------------------------------------------------------------------

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  address text,
  city text,
  source text,
  ghl_contact_id text,
  created_at timestamptz not null default now()
);

create table if not exists site_walks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id),
  audio_path text,
  transcript text,
  transcript_provider text,
  duration_seconds int,
  input_mode text not null check (input_mode in ('audio', 'text')),
  created_at timestamptz not null default now()
);

create table if not exists extractions (
  id uuid primary key default gen_random_uuid(),
  site_walk_id uuid not null references site_walks (id),
  raw_json jsonb not null,
  schema_valid boolean not null default false,
  retry_count int not null default 0,
  created_at timestamptz not null default now()
);

-- Rule 5: nothing reaches a customer without a human approval record. The
-- constraint below makes 'sent' impossible without approved_by/approved_at,
-- regardless of which code path writes the row.
create table if not exists proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id),
  site_walk_id uuid not null references site_walks (id),
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'approved', 'sent', 'rejected')),
  subtotal numeric,
  mobilization_fee numeric,
  contingency numeric,
  tax numeric,
  total numeric,
  cost_total numeric,
  margin_pct numeric,
  narrative text,
  exclusions text,
  version int not null default 1,
  approved_by text,
  approved_at timestamptz,
  sent_at timestamptz,
  pdf_path text,
  public_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),

  constraint proposals_sent_requires_approval
    check (status <> 'sent' or (approved_by is not null and approved_at is not null))
);

create table if not exists proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals (id) on delete cascade,
  catalog_item_id uuid references catalog_items (id),
  description text not null,
  qty numeric not null,
  unit text not null,
  unit_price numeric not null,
  unit_cost numeric not null,
  line_total numeric not null,
  match_method text
    check (match_method in ('vector', 'lexical', 'hybrid', 'manual', 'unmatched')),
  match_confidence numeric,
  transcript_evidence text,
  evidence_verified boolean not null default false,
  needs_review boolean not null default false,
  sort_order int
);

-- ---------------------------------------------------------------------------
-- Observability and guardrails
-- ---------------------------------------------------------------------------

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references proposals (id),
  site_walk_id uuid references site_walks (id),
  step text not null,
  model text not null,
  tokens_in int,
  tokens_out int,
  cost_usd numeric(10, 6),
  latency_ms int,
  status text not null check (status in ('ok', 'retried', 'failed', 'aborted')),
  error text,
  created_at timestamptz not null default now()
);

create table if not exists guardrail_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals (id),
  rule text not null,
  severity text not null check (severity in ('block', 'warn')),
  passed boolean not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- Rule 7: external sends are idempotent via the unique idempotency_key.
create table if not exists outbound_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals (id),
  channel text not null check (channel in ('email', 'sms', 'slack', 'ghl', 'stripe')),
  idempotency_key text not null unique,
  payload jsonb,
  provider_message_id text,
  status text,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

-- Second half of rule 5: even an approved-by-accident insert path cannot queue
-- email/SMS for a proposal the database has never marked approved (or sent).
create or replace function enforce_outbound_channel_gate()
returns trigger
language plpgsql
as $$
begin
  if new.channel in ('email', 'sms') then
    if not exists (
      select 1
      from proposals p
      where p.id = new.proposal_id
        and p.status in ('approved', 'sent')
    ) then
      raise exception
        'outbound_events channel "%" requires parent proposal status approved or sent (proposal %)',
        new.channel, new.proposal_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists outbound_events_channel_gate on outbound_events;
create trigger outbound_events_channel_gate
  before insert on outbound_events
  for each row execute function enforce_outbound_channel_gate();

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text,
  action text not null,
  entity_type text,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The app talks to Postgres exclusively through the service-role server
-- client, which bypasses RLS. Enabling RLS with no policies deny-all's
-- anon/authenticated keys so a leaked publishable key can read nothing.
-- ---------------------------------------------------------------------------

alter table catalog_items enable row level security;
alter table leads enable row level security;
alter table site_walks enable row level security;
alter table extractions enable row level security;
alter table proposals enable row level security;
alter table proposal_line_items enable row level security;
alter table agent_runs enable row level security;
alter table guardrail_events enable row level security;
alter table outbound_events enable row level security;
alter table audit_log enable row level security;
