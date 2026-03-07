ALTER TABLE "agent_wakeup_requests"
  ADD COLUMN IF NOT EXISTS "gate_model" text,
  ADD COLUMN IF NOT EXISTS "gate_failure_code" text,
  ADD COLUMN IF NOT EXISTS "gate_used_default_model" boolean NOT NULL DEFAULT false;
