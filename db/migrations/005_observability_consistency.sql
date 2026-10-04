-- Earlier diagnostic drafts counted generated content as pipeline success.
-- A BLOCKED operation must never count as a successful pipeline outcome.
UPDATE operation_runs
SET metadata=metadata || jsonb_build_object(
  'counter_correction',jsonb_build_object(
    'previous_success_count',success_count,
    'reason','Blocked output is not a successful pipeline outcome',
    'corrected_at',now()
  )
),success_count=0
WHERE status='BLOCKED' AND success_count>0;
