-- 0010_line_item_soft_delete — reviewers remove a line without destroying it:
-- excluded lines stay visible in the review UI (struck through, with the
-- required reason) but never price, never render to the customer, and never
-- reach the PDF or /p/[token].

alter table proposal_line_items
  add column if not exists excluded boolean not null default false,
  add column if not exists excluded_reason text;
