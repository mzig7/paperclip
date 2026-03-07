ALTER TABLE "agent_wakeup_requests"
  ADD COLUMN IF NOT EXISTS "gate_decision" text,
  ADD COLUMN IF NOT EXISTS "gate_reason_code" text,
  ADD COLUMN IF NOT EXISTS "gate_next_check_hint_sec" integer,
  ADD COLUMN IF NOT EXISTS "gate_mode" text,
  ADD COLUMN IF NOT EXISTS "gate_evaluated_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "expensive_run_launched" boolean NOT NULL DEFAULT false;

UPDATE "agent_wakeup_requests"
SET "idempotency_key" = NULL,
    "updated_at" = now()
WHERE "idempotency_key" IS NOT NULL
  AND btrim("idempotency_key") = '';

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY company_id, agent_id, idempotency_key
           ORDER BY requested_at ASC, created_at ASC, id ASC
         ) AS rn
  FROM "agent_wakeup_requests"
  WHERE "idempotency_key" IS NOT NULL
)
UPDATE "agent_wakeup_requests" awr
SET "idempotency_key" = NULL,
    "updated_at" = now()
FROM ranked
WHERE awr.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_wakeup_requests_company_agent_idempotency_idx"
  ON "agent_wakeup_requests" ("company_id", "agent_id", "idempotency_key");
