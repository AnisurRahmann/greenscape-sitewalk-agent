-- 0006_proposals_bucket.sql — private bucket for generated proposal PDFs.
-- Written and read through service-role signed URLs / server code only;
-- clients get short-lived signed download links, never bucket access.

insert into storage.buckets (id, name, public)
values ('proposals', 'proposals', false)
on conflict (id) do nothing;
