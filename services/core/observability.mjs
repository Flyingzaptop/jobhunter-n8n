import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
export const operationContext = new AsyncLocalStorage();
export const STAGE_NAMES = [
  "Discovery",
  "Normalize / dedupe",
  "Fit analysis",
  "CV factory",
  "Application / HITL",
  "Reporting",
];
export function sanitize(value, depth = 0) {
  if (value instanceof Date) return value.toISOString();
  if (depth > 9) return "[depth limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string")
    return value
      .replace(
        /https?:\/\/api\.telegram\.org\/bot[^/\s]+/gi,
        "https://api.telegram.org/bot[redacted]",
      )
      .slice(0, 16000);
  if (Array.isArray(value))
    return value.slice(0, 500).map((v) => sanitize(v, depth + 1));
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([k]) =>
          [
            "tokens",
            "token_count",
            "input_tokens",
            "output_tokens",
            "prompt_eval_count",
            "eval_count",
          ].includes(k) ||
          !/password|token|authorization|cookie|storage_state|raw_prompt|chain.of.thought|hidden_reasoning|credential|secret/i.test(
            k,
          ),
      )
      .map(([k, v]) => [k, sanitize(v, depth + 1)]),
  );
}
export async function observe(repo, event) {
  const context = operationContext.getStore();
  if (!context) return;
  const clean = sanitize(event);
  const entity = clean.entity_id ?? clean.source_id ?? null;
  await repo.pool.query(
    `UPDATE operation_runs SET heartbeat_at=now(),message=$2,
  current_entity=COALESCE($3,current_entity),processed_count=COALESCE($4,processed_count),
  success_count=COALESCE($5,success_count),failure_count=COALESCE($6,failure_count),
  total_count=COALESCE($7,total_count) WHERE run_id=$1`,
    [
      context.run_id,
      clean.message ?? clean.event ?? "",
      entity
        ? {
            entity_type: clean.entity_type ?? "source",
            entity_id: entity,
            ...clean,
          }
        : null,
      clean.processed_count ?? null,
      clean.success_count ?? null,
      clean.failure_count ?? null,
      clean.total_count ?? null,
    ],
  );
  await repo.event(
    clean.entity_type ?? "operation",
    String(entity ?? context.run_id),
    clean.event ?? "OPERATION_PROGRESS",
    { ...clean, run_id: context.run_id, stage: context.stage },
  );
}
export async function runObserved(
  repo,
  stage,
  body,
  fn,
  { trigger = "n8n", mode = "REAL" } = {},
) {
  const run_id = randomUUID();
  await repo.pool.query(
    `INSERT INTO operation_runs(run_id,stage,trigger,mode,status,message) VALUES($1,$2,$3,$4,'RUNNING',$5)`,
    [run_id, stage, trigger, mode, `${STAGE_NAMES[stage - 1]} started`],
  );
  return operationContext.run({ run_id, stage }, async () => {
    try {
      await repo.event("operation", run_id, "OPERATION_STARTED", {
        run_id,
        stage,
        trigger,
        mode,
      });
      const result = await fn();
      const results = result?.results ?? [];
      const errors =
        result?.errors?.length ?? results.filter((r) => r.error).length;
      const blocked =
        result?.blocked_reason ??
        (result?.status?.startsWith("BLOCKED") ? result.status : null);
      const status = blocked
        ? "BLOCKED"
        : errors && !(result?.analyzed ?? result?.discovered ?? results.length)
          ? "FAILED"
          : "SUCCEEDED";
      const processed =
        result?.attempted ??
        result?.discovered ??
        result?.raw_count ??
        result?.generated ??
        result?.started ??
        results.length;
      await repo.pool.query(
        `UPDATE operation_runs SET status=$2,completed_at=now(),heartbeat_at=now(),processed_count=$3,success_count=$4,failure_count=$5,message=$6,metadata=metadata||$7::jsonb WHERE run_id=$1`,
        [
          run_id,
          status,
          processed,
          blocked ? 0 : Math.max(0, processed - errors),
          errors,
          blocked ?? `${STAGE_NAMES[stage - 1]} ${status.toLowerCase()}`,
          sanitize({ result_summary: { ...result, results: undefined }, mode }),
        ],
      );
      await repo.event("operation", run_id, "OPERATION_COMPLETED", {
        run_id,
        stage,
        status,
        processed_count: processed,
        failure_count: errors,
      });
      return { ...result, operation_run_id: run_id };
    } catch (error) {
      await repo.pool.query(
        "UPDATE operation_runs SET status='FAILED',completed_at=now(),message=$2,metadata=metadata||$3::jsonb WHERE run_id=$1",
        [
          run_id,
          "Operation failed",
          { error_code: error.name, validation_error: sanitize(error.message) },
        ],
      );
      await repo.event("operation", run_id, "OPERATION_FAILED", {
        run_id,
        stage,
        error_code: error.name,
        message: sanitize(error.message),
      });
      throw error;
    }
  });
}
