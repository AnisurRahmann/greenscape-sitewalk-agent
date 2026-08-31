-- 0007_outbound_error.sql — record the last dispatch error next to attempts
-- so a failed send is diagnosable from the row alone.

alter table outbound_events
  add column if not exists error text;
