import { mkdir, writeFile } from "node:fs/promises";
export function summarize(rows) {
  const statuses = {};
  for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  return {
    total: rows.length,
    statuses,
    submitted: statuses.SUBMITTED ?? 0,
    awaiting_user: (statuses.NEEDS_USER ?? 0) + (statuses.CAPTCHA_WAIT ?? 0),
    failed: statuses.FAILED ?? 0,
  };
}
const csv = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
const md = (value) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
export async function report(
  repo,
  { outputDir = "data/exports", telegram } = {},
) {
  const { rows } = await repo.pool
    .query(`SELECT a.*,j.company,j.title,j.location,j.work_mode,j.canonical_url,j.application_url,c.sha256 AS cv_sha256,c.pdf_path,
 (SELECT overall_fit FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC LIMIT 1) AS fit_score,
 o.outcome_status AS latest_outcome,o.recorded_at AS latest_outcome_at
 FROM applications a JOIN jobs j USING(job_id) LEFT JOIN cv_versions c USING(cv_id)
 LEFT JOIN LATERAL (SELECT * FROM application_outcomes WHERE application_id=a.application_id ORDER BY recorded_at DESC LIMIT 1) o ON true ORDER BY a.started_at`);
  const metrics = summarize(rows);
  const counts = (
    await repo.pool.query(
      `SELECT (SELECT count(*) FROM jobs_raw)::int AS discovered,(SELECT count(*) FROM jobs)::int AS unique,(SELECT count(DISTINCT job_id) FROM job_analysis)::int AS analyzed,(SELECT count(*) FROM cv_versions)::int AS cvs`,
    )
  ).rows[0];
  const bands = (
    await repo.pool.query(
      `SELECT decision,count(*)::int FROM (SELECT DISTINCT ON(job_id) job_id,decision FROM job_analysis ORDER BY job_id,created_at DESC) t GROUP BY decision`,
    )
  ).rows;
  const outcomes = (
    await repo.pool.query(
      `SELECT outcome_status,count(*)::int FROM (SELECT DISTINCT ON(application_id) application_id,outcome_status FROM application_outcomes ORDER BY application_id,recorded_at DESC) t GROUP BY outcome_status`,
    )
  ).rows;
  const fields = [
    "application_id",
    "submitted_at",
    "company",
    "title",
    "location",
    "work_mode",
    "fit_score",
    "canonical_url",
    "application_url",
    "cv_id",
    "cv_sha256",
    "status",
    "confirmation_id",
    "latest_outcome",
    "latest_outcome_at",
  ];
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    `${outputDir}/applications_log.csv`,
    [
      fields.join(","),
      ...rows.map((r) => fields.map((k) => csv(r[k])).join(",")),
    ].join("\n") + "\n",
  );
  await writeFile(
    `${outputDir}/APPLICATIONS_LOG.md`,
    "# Application ledger\n\n| Applied | Company | Role | Location | Fit | Status | Source | CV | Confirmation |\n|---|---|---|---|---|---|---|---|---|\n" +
      rows
        .filter((r) => r.status === "SUBMITTED")
        .map((r) =>
          [
            r.submitted_at,
            r.company,
            r.title,
            r.location,
            r.fit_score,
            r.status,
            r.canonical_url,
            r.pdf_path,
            r.confirmation_id,
          ]
            .map(md)
            .join(" | "),
        )
        .map((s) => "| " + s + " |")
        .join("\n") +
      "\n",
  );
  const suitable = bands
      .filter((r) => ["AUTO_APPLY", "REVIEW", "STRETCH"].includes(r.decision))
      .reduce((n, r) => n + r.count, 0),
    skipped = metrics.statuses.SKIPPED ?? 0;
  const summary = { ...counts, ...metrics, suitable, skipped, bands, outcomes };
  await writeFile(
    `${outputDir}/summary.json`,
    JSON.stringify(summary, null, 2),
  );
  if (telegram)
    await telegram.send(
      `JobHunter summary\nDiscovered: ${counts.discovered}\nUnique: ${counts.unique}\nAnalyzed: ${counts.analyzed}\nSuitable: ${suitable}\n${bands.map((r) => `${r.decision}: ${r.count}`).join("\n")}\nSubmitted: ${metrics.submitted}\nAwaiting user: ${metrics.awaiting_user}\nFailed: ${metrics.failed}\nSkipped: ${skipped}\nCVs: ${counts.cvs}`,
    );
  return summary;
}
