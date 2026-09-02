-- 0011_corrections — every review correction is captured as a labelled
-- training signal: what the machine proposed, what a human chose, and the
-- query it came from. Feeds matcher/extractor improvement loops and the
-- human-touch-rate report.

create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  line_item_id uuid references proposal_line_items(id) on delete set null,
  correction_type text not null
    check (correction_type in ('qty', 'price', 'remove', 'remap', 'add')),
  before jsonb,
  after jsonb,
  original_query text,
  rejected_catalog_item_id uuid references catalog_items(id),
  chosen_catalog_item_id uuid references catalog_items(id),
  match_confidence_at_time numeric,
  created_at timestamptz not null default now()
);

create index if not exists corrections_created_at_idx on corrections (created_at);
create index if not exists corrections_proposal_idx on corrections (proposal_id);

alter table corrections enable row level security;
