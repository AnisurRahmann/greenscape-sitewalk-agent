-- 0008_line_item_discount_bps — record the volume tier applied to each line.
-- unit_price now carries the catalog LIST price; the applied tier lives here,
-- so re-running the pricing engine over stored lines applies the tier exactly
-- once (idempotent repricing in the review UI and at approval time).

alter table proposal_line_items
  add column if not exists discount_bps int not null default 0;
