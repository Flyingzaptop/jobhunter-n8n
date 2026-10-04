import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { factIndex } from "../core/fit.mjs";
import { sanitize, STAGE_NAMES } from "../core/observability.mjs";
const load = async (name) =>
  YAML.parse(await readFile(`config/${name}.yaml`, "utf8"));
export const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export function pageParams(params) {
  return {
    limit: Math.min(100, Math.max(1, Number(params.get("limit") ?? 25) || 25)),
    offset: Math.max(0, Number(params.get("offset") ?? 0) || 0),
  };
}
export async function pipeline(repo) {
  const runs = (
    await repo.pool.query(
      "SELECT DISTINCT ON(stage) * FROM operation_runs WHERE mode=$1 ORDER BY stage,CASE WHEN status='RUNNING' AND heartbeat_at>now()-interval '15 minutes' THEN 0 ELSE 1 END,started_at DESC",
      ["REAL"],
    )
  ).rows;
  const paused = (
    await repo.pool.query("SELECT paused FROM runtime_control WHERE id=true")
  ).rows[0]?.paused;
  return STAGE_NAMES.map((title, i) => {
    const run = runs.find((r) => r.stage === i + 1);
    return {
      stage: i + 1,
      title,
      status: paused ? "PAUSED" : (run?.status ?? "IDLE"),
      ...(run
        ? sanitize(run)
        : {
            run_id: null,
            message: "No recorded run",
            processed_count: 0,
            success_count: 0,
            failure_count: 0,
          }),
      remaining_count:
        run?.total_count == null
          ? null
          : Math.max(0, run.total_count - run.processed_count),
    };
  });
}
export async function onboarding(providedProfile) {
  const profile = providedProfile??await load("candidate_profile");
  const missing = [];
  function walk(object, prefix = "") {
    for (const [key, value] of Object.entries(object ?? {})) {
      const p = prefix ? `${prefix}.${key}` : key;
      if (value === "UNKNOWN" || value == null) missing.push(p);
      else if (typeof value === "object") walk(value, p);
    }
  }
  walk(profile);
  return {
    missing_fields: missing,
    professional_web_tools_question:
      "Were any React/Django/internal web tools actually created as part of professional hospital employment?",
    profile_version: profile.profile_version ?? null,
  };
}
export async function profileFacts() {
  return [...factIndex(await load("candidate_profile")).values()];
}
export async function jobs(repo, params) {
  const filters = [],
    values = [];
  const add = (sql, value) => {
    values.push(value);
    filters.push(sql.replace("?", `$${values.length}`));
  };
  const exact = {
    decision: "a.decision",
    company: "j.company",
    country: "j.country",
    role_family: "a.analysis_json->>'role_family'",
    work_format: "a.analysis_json->>'work_format_class'",
    work_mode: "j.work_mode",
    application_status: "app.status",
  };
  for (const [key, field] of Object.entries(exact))
    if (params.get(key)) add(`${field}=?`, params.get(key));
  if (params.get("q"))
    add(
      "(j.title||' '||j.company||' '||COALESCE(j.location,'')) ILIKE ?",
      `%${params.get("q").slice(0, 200)}%`,
    );
  if (params.get("source"))
    add(
      "EXISTS(SELECT1 FROM job_sources s WHERE s.job_id=j.job_id AND s.source_name=?)".replace(
        "SELECT1",
        "SELECT 1",
      ),
      params.get("source"),
    );
  for (const [key, sign] of [
    ["min_fit", ">="],
    ["max_fit", "<="],
  ])
    if (params.get(key) !== null) {
      const n = Number(params.get(key));
      if (!Number.isFinite(n) || n < 0 || n > 100)
        throw new Error("Invalid fit range");
      add(`a.overall_fit${sign}?`, n);
    }
  if (params.get("analyzed"))
    filters.push(
      params.get("analyzed") === "true"
        ? "a.analysis_id IS NOT NULL"
        : "a.analysis_id IS NULL",
    );
  if (params.get("cv"))
    filters.push(
      params.get("cv") === "true" ? "cv.cv_id IS NOT NULL" : "cv.cv_id IS NULL",
    );
  for (const [key, column] of [
    ["seen_after", "j.first_seen_at"],
    ["published_after", "NULLIF(j.metadata->>'published_at','')::timestamptz"],
  ])
    if (params.get(key)) {
      if (!Number.isFinite(Date.parse(params.get(key))))
        throw new Error("Invalid date filter");
      add(`${column}>=?`, params.get(key));
    }
  const { limit, offset } = pageParams(params);
  const base =
    `FROM jobs j LEFT JOIN LATERAL(SELECT * FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC LIMIT1) a ON true LEFT JOIN LATERAL(SELECT * FROM applications WHERE job_id=j.job_id ORDER BY started_at DESC LIMIT1) app ON true LEFT JOIN LATERAL(SELECT cv_id FROM cv_versions WHERE job_id=j.job_id ORDER BY created_at DESC LIMIT1) cv ON true ${filters.length ? "WHERE " + filters.join(" AND ") : ""}`.replaceAll(
      "LIMIT1",
      "LIMIT 1",
    );
  const total = (
    await repo.pool.query(`SELECT count(*)::int AS n ${base}`, values)
  ).rows[0].n;
  const rows = (
    await repo.pool.query(
      `SELECT j.*,a.overall_fit,a.application_priority,a.decision,a.analysis_json AS analysis,app.status AS application_status,cv.cv_id,(SELECT array_agg(DISTINCT s.source_name) FROM job_sources s WHERE s.job_id=j.job_id) AS source_names ${base} ORDER BY j.last_seen_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    )
  ).rows;
  return { data: rows.map((row) => sanitize(row)), total, limit, offset };
}
export async function jobDetail(repo, id) {
  if (!uuid(id)) throw new Error("Invalid job ID");
  const job = (
    await repo.pool.query("SELECT * FROM jobs WHERE job_id=$1", [id])
  ).rows[0];
  if (!job) return null;
  const mappings = (
    await repo.pool.query("SELECT * FROM job_sources WHERE job_id=$1", [id])
  ).rows;
  const raw = (
    await repo.pool.query(
      `SELECT r.* FROM jobs_raw r JOIN job_sources s ON s.source_name=r.source_name AND s.source_url=r.source_url WHERE s.job_id=$1`,
      [id],
    )
  ).rows;
  const analysis = (
    await repo.pool.query(
      "SELECT * FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1",
      [id],
    )
  ).rows[0];
  const ids = new Set(analysis?.analysis_json?.matched_fact_ids ?? []);
  const facts = (await profileFacts()).filter((f) => ids.has(f.id));
  const cvs = (
    await repo.pool.query(
      "SELECT * FROM cv_versions WHERE job_id=$1 ORDER BY created_at DESC",
      [id],
    )
  ).rows;
  const drafts = (
    await repo.pool.query(
      "SELECT * FROM cv_drafts WHERE job_id=$1 ORDER BY created_at DESC",
      [id],
    )
  ).rows;
  const apps = (
    await repo.pool.query(
      "SELECT * FROM applications WHERE job_id=$1 ORDER BY started_at DESC",
      [id],
    )
  ).rows;
  const events = (
    await repo.pool.query(
      `SELECT * FROM events WHERE (entity_type='job' AND entity_id=$1) OR (entity_type='application' AND entity_id=ANY($2::text[])) ORDER BY created_at`,
      [id, apps.map((a) => a.application_id)],
    )
  ).rows;
  return sanitize({
    job,
    raw_sources: raw,
    source_mappings: mappings,
    analysis: analysis ? { ...analysis, ...analysis.analysis_json } : null,
    facts,
    cvs: [...cvs, ...drafts],
    applications: apps,
    events,
    priority_components: analysis?.analysis_json?.priority_components ?? null,
  });
}
export async function applicationDetail(repo, id) {
  if (!uuid(id)) throw new Error("Invalid application ID");
  const app = (
    await repo.pool.query(
      "SELECT * FROM applications WHERE application_id=$1",
      [id],
    )
  ).rows[0];
  if (!app) return null;
  return sanitize({
    application: app,
    job: (
      await repo.pool.query("SELECT * FROM jobs WHERE job_id=$1", [app.job_id])
    ).rows[0],
    questions: (
      await repo.pool.query(
        "SELECT * FROM application_questions WHERE application_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows,
    events: (
      await repo.pool.query(
        "SELECT * FROM events WHERE entity_type='application' AND entity_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows,
    cv: (
      await repo.pool.query("SELECT * FROM cv_versions WHERE cv_id=$1", [
        app.cv_id,
      ])
    ).rows[0],
  });
}
export { load };
