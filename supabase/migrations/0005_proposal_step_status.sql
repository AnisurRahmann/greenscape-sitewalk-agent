-- 0005_proposal_step_status.sql — live pipeline progress for the UI.
-- The orchestrator updates this jsonb as each step advances; a polling
-- endpoint reads it so the browser sees progress without blocking the run.

alter table proposals
  add column if not exists step_status jsonb;
