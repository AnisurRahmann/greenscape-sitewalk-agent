-- 0003_storage.sql — private bucket for site-walk audio recordings.
-- Uploads go through service-role signed upload URLs; downloads happen
-- server-side in transcribe.ts. No policies needed: every path bypasses
-- the anon/authenticated roles entirely.

insert into storage.buckets (id, name, public)
values ('sitewalks', 'sitewalks', false)
on conflict (id) do nothing;
