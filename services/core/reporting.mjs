import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const REPORT_TIMEZONE = 'Europe/Warsaw';
const warsawDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:REPORT_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const actionable = new Set(['AUTO_APPLY', 'REVIEW', 'STRETCH']);
const outcomeFields = { RECRUITER_REPLY: 'recruiter_replies', HR_SCREEN: 'hr_screens',
  TECHNICAL_INTERVIEW: 'technical_interviews', INTERVIEW_OTHER: 'other_interviews', OFFER: 'offers',
  REJECTED: 'rejections', WITHDRAWN: 'withdrawals', CLOSED_BY_EMPLOYER: 'closed_by_employer' };
const dimensions = ['role_family', 'fit_band', 'source', 'work_format', 'seniority', 'cv_template_version', 'cv_prompt_version'];
const csv = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const md = value => String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');

export function warsawDate(value = new Date()) {
  if (!value || !Number.isFinite(new Date(value).getTime())) throw new Error('Invalid reporting timestamp');
  return warsawDateFormatter.format(new Date(value));
}
function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('Invalid report date');
  return value;
}
function shiftDate(value, days) {
  const date = new Date(value + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const inPeriod = (timestamp, start, end) => timestamp != null && warsawDate(timestamp) >= start && warsawDate(timestamp) < end;

export function summarize(rows) {
  const statuses = {};
  for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  return { total: rows.length, statuses, submitted: statuses.SUBMITTED ?? 0,
    awaiting_user: (statuses.NEEDS_USER ?? 0) + (statuses.CAPTCHA_WAIT ?? 0),
    manual_takeover: statuses.MANUAL_TAKEOVER ?? 0, failed: statuses.FAILED ?? 0 };
}
function bandsFor(jobs) {
  const counts = {};
  for (const job of jobs) if (job.decision) counts[job.decision] = (counts[job.decision] ?? 0) + 1;
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([decision, count]) => ({ decision, count }));
}
function rejectionReasons(jobs) {
  const counts = new Map();
  for (const job of jobs.filter(j => j.decision === 'REJECT')) {
    for (const reason of new Set(job.analysis_json?.reasons ?? [])) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).slice(0, 5).map(([reason, count]) => ({reason,count}));
}
export function geographyCounts(jobs) {
  const counts = { remote_worldwide_eu_from_poland: 0, remote_poland: 0, wroclaw_local_hybrid: 0,
    wroclaw_local_onsite_review: 0, poland_rare_travel_hybrid: 0, europe_relocation_review: 0,
    rejected_country_work_authorization: 0, work_format_unknown_review: 0 };
  for (const job of jobs) {
    const a = job.analysis_json ?? {}, f = a.work_format_class ?? 'UNKNOWN';
    const rejected = job.decision === 'REJECT' && (f === 'REMOTE_COUNTRY_LOCKED_INELIGIBLE'
      || a.work_format?.authorization_known_impossible === true || a.reasons?.includes('WORK_AUTHORIZATION_IMPOSSIBLE'));
    if (rejected) counts.rejected_country_work_authorization++;
    else if (['REMOTE_WORLDWIDE_FROM_POLAND', 'REMOTE_EUROPE_FROM_POLAND'].includes(f)) counts.remote_worldwide_eu_from_poland++;
    else if (f === 'REMOTE_POLAND') counts.remote_poland++;
    else if (f === 'HYBRID_WROCLAW_LOCAL') counts.wroclaw_local_hybrid++;
    else if (f === 'ONSITE_WROCLAW_LOCAL' && job.decision === 'REVIEW') counts.wroclaw_local_onsite_review++;
    else if (f === 'HYBRID_POLAND_RARE_TRAVEL') counts.poland_rare_travel_hybrid++;
    else if (['HYBRID_EUROPE_RELOCATION_REVIEW', 'ONSITE_EUROPE_RELOCATION_REVIEW'].includes(f) && job.decision === 'REVIEW') counts.europe_relocation_review++;
    else if (f === 'UNKNOWN' || job.decision === 'REVIEW') counts.work_format_unknown_review++;
  }
  return counts;
}

export function weeklyFunnel(rows, { start, end, minSample = 5 } = {}) {
  if (!Number.isInteger(minSample) || minSample < 1) throw new Error('Minimum conversion sample must be a positive integer');
  const submitted = rows.filter(r => r.status === 'SUBMITTED' && inPeriod(r.submitted_at, start, end));
  const funnel = cohort => {
    const result = { submitted: cohort.length, ...Object.fromEntries(Object.values(outcomeFields).map(k => [k, 0])), no_response_still_pending: 0, unknown: 0 };
    for (const r of cohort) {
      const history = r.outcome_history ?? [];
      const reached = new Set(history.map(o => o.outcome_status));
      for (const [status, key] of Object.entries(outcomeFields)) if (reached.has(status)) result[key]++;
      const latest = history.at(-1)?.outcome_status;
      if (!latest || latest === 'NO_RESPONSE') result.no_response_still_pending++;
      if (latest === 'UNKNOWN') result.unknown++;
    }
    result.rates = Object.fromEntries(Object.values(outcomeFields).map(key => [key, cohort.length ? result[key] / cohort.length : null]));
    return result;
  };
  const breakdowns = {};
  for (const dimension of dimensions) {
    const groups = new Map();
    for (const row of submitted) { const key = row[dimension] ?? 'UNKNOWN'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
    breakdowns[dimension] = [...groups].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([value, cohort]) => ({
      value, sample_size: cohort.length, sufficient_sample: cohort.length >= minSample,
      ...(value === 'UNKNOWN' ? { missing_metadata: true } : {}),
      ...(cohort.length >= minSample ? { funnel: funnel(cohort) } : {}),
    }));
  }
  const activity = Object.fromEntries(Object.values(outcomeFields).map(k => [k, new Set()]));
  for (const row of rows.filter(r => r.status === 'SUBMITTED')) for (const outcome of row.outcome_history ?? []) {
    const field = outcomeFields[outcome.outcome_status];
    if (field && inPeriod(outcome.recorded_at, start, end)) activity[field].add(row.application_id);
  }
  return { period: { start, end_exclusive: end, timezone: REPORT_TIMEZONE }, cohort_basis: 'submitted_at',
    stage_basis: 'distinct applications with explicitly recorded stage; stages may overlap', min_sample: minSample,
    funnel: funnel(submitted), outcome_activity: Object.fromEntries(Object.entries(activity).map(([key, ids]) => [key, ids.size])), breakdowns };
}

function applicationFields(row) {
  const a = row.analysis_json ?? {}, f = a.work_format ?? {}, eligibility = a.employment_eligibility ?? {};
  return { ...row, applied_at: row.submitted_at, role: row.title,
    role_family: a.role_family ?? null, fit_band: row.decision ?? null, seniority: a.role_level ?? null,
    work_format: a.work_format_class ?? null, work_format_class: a.work_format_class ?? null,
    office_location: f.office_location ?? null,
    onsite_frequency: f.onsite_frequency_text ?? (f.onsite_days_per_week != null ? `${f.onsite_days_per_week} days/week` : f.onsite_days_per_month != null ? `${f.onsite_days_per_month} days/month` : null),
    employment_route: f.employment_route ?? eligibility.hire_route ?? null,
    work_from_poland_allowed: f.work_from_poland_allowed ?? eligibility.work_from_poland_allowed ?? null,
    relocation_required: f.relocation_required ?? null,
    notes: [row.skip_reason, row.failure_reason, row.submit_blocked_reason, row.latest_outcome_notes].filter(Boolean).join('; '),
  };
}

async function atomicWrite(outputDir, filename, content) {
  const target = path.join(outputDir, filename), temporary = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}

export async function report(repo, { outputDir = 'data/exports', telegram, date = warsawDate(), minSample = 5, weekly = false } = {}) {
  calendarDate(date);
  const end = shiftDate(date, 1), day = new Date(date + 'T00:00:00Z').getUTCDay();
  const weekStart = shiftDate(date, -((day + 6) % 7));
  // One PostgreSQL statement gives all components a consistent MVCC snapshot.
  const { rows: [snapshot] } = await repo.pool.query(`WITH latest_analysis AS (
    SELECT DISTINCT ON(job_id) * FROM job_analysis WHERE created_at < ($2::date::timestamp AT TIME ZONE 'Europe/Warsaw') ORDER BY job_id,created_at DESC,analysis_id DESC
  ), app AS (
    SELECT a.*,j.company,j.title,j.location,j.work_mode,j.canonical_url,j.application_url,
      c.sha256 AS cv_sha256,c.pdf_path,c.template_version AS cv_template_version,c.manifest_json->>'prompt_version' AS cv_prompt_version,
      n.overall_fit AS fit_score,n.decision,n.analysis_json,
      s.source_name AS source,o.history AS outcome_history,
      o.latest->>'outcome_status' AS latest_outcome,o.latest->>'recorded_at' AS latest_outcome_at,o.latest->>'notes' AS latest_outcome_notes
    FROM applications a JOIN jobs j USING(job_id) LEFT JOIN cv_versions c USING(cv_id)
    LEFT JOIN LATERAL (SELECT * FROM job_analysis WHERE job_id=j.job_id AND created_at <= COALESCE(a.submitted_at,a.started_at) ORDER BY created_at DESC,analysis_id DESC LIMIT 1) n ON true
    LEFT JOIN LATERAL (SELECT source_name FROM job_sources WHERE job_id=j.job_id AND first_seen_at <= COALESCE(a.submitted_at,a.started_at) ORDER BY first_seen_at,source_name,source_url LIMIT 1) s ON true
    LEFT JOIN LATERAL (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY recorded_at,outcome_id),'[]'::jsonb) AS history,
      (jsonb_agg(to_jsonb(t) ORDER BY recorded_at DESC,outcome_id DESC))->0 AS latest FROM application_outcomes t
      WHERE application_id=a.application_id AND recorded_at < ($2::date::timestamp AT TIME ZONE 'Europe/Warsaw')) o ON true
    WHERE a.started_at < ($2::date::timestamp AT TIME ZONE 'Europe/Warsaw')
  ) SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(app) ORDER BY started_at,application_id) FROM app),'[]'::jsonb) AS applications,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('job_id',j.job_id,'first_seen_at',j.first_seen_at,'analysis_at',n.created_at,'decision',n.decision,'analysis_json',n.analysis_json) ORDER BY j.job_id)
      FROM jobs j LEFT JOIN latest_analysis n USING(job_id) WHERE j.first_seen_at < ($2::date::timestamp AT TIME ZONE 'Europe/Warsaw')),'[]'::jsonb) AS jobs,
    (SELECT count(*)::int FROM jobs_raw WHERE discovered_at < ($2::date::timestamp AT TIME ZONE 'Europe/Warsaw')) AS discovered,
    (SELECT count(*)::int FROM jobs_raw WHERE (discovered_at AT TIME ZONE 'Europe/Warsaw')::date=$1::date) AS daily_discovered,
    (SELECT count(*)::int FROM cv_versions WHERE created_at < ($2::date::timestamp AT TIME ZONE 'Europe/Warsaw')) AS cvs,
    (SELECT count(*)::int FROM cv_versions WHERE (created_at AT TIME ZONE 'Europe/Warsaw')::date=$1::date) AS daily_cvs`, [date, end]);
  const rows = snapshot.applications.map(applicationFields), jobs = snapshot.jobs;
  const metrics = summarize(rows), bands = bandsFor(jobs);
  const outcomesMap = {};
  for (const row of rows) if (row.latest_outcome) outcomesMap[row.latest_outcome] = (outcomesMap[row.latest_outcome] ?? 0) + 1;
  const cumulative = { discovered: snapshot.discovered, unique: jobs.length, analyzed: jobs.filter(j => j.analysis_at).length,
    cvs: snapshot.cvs, ...metrics, suitable: jobs.filter(j => actionable.has(j.decision)).length,
    skipped: metrics.statuses.SKIPPED ?? 0, bands,
    outcomes: Object.entries(outcomesMap).sort(([a], [b]) => a.localeCompare(b)).map(([outcome_status, count]) => ({ outcome_status, count })),
    work_format_geography: geographyCounts(jobs.filter(j => j.analysis_at)), top_rejection_reasons: rejectionReasons(jobs) };
  const analyzedToday = jobs.filter(j => inPeriod(j.analysis_at, date, end));
  const dailyMetrics = summarize(rows.filter(r => inPeriod(r.updated_at, date, end)));
  const daily = { date, timezone: REPORT_TIMEZONE, discovered: snapshot.daily_discovered,
    unique: jobs.filter(j => inPeriod(j.first_seen_at, date, end)).length, analyzed: analyzedToday.length,
    cvs: snapshot.daily_cvs, ...dailyMetrics, submitted: rows.filter(r => r.status === 'SUBMITTED' && inPeriod(r.submitted_at, date, end)).length,
    suitable: analyzedToday.filter(j => actionable.has(j.decision)).length, skipped: dailyMetrics.statuses.SKIPPED ?? 0,
    bands: bandsFor(analyzedToday), work_format_geography: geographyCounts(analyzedToday),
    current_awaiting_user_backlog: metrics.awaiting_user, top_rejection_reasons: rejectionReasons(analyzedToday) };
  const weeklyReport = weeklyFunnel(rows, { start: weekStart, end, minSample });
  weeklyReport.work_format_geography = geographyCounts(jobs.filter(j => inPeriod(j.analysis_at, weekStart, end)));
  const summary = { ...cumulative, scope: 'cumulative', reporting_date: date, timezone: REPORT_TIMEZONE, daily, cumulative, weekly: weeklyReport };
  const fields = ['application_id','submitted_at','applied_at','company','title','role','location','work_mode','fit_score','fit_band','role_family','seniority','source',
    'canonical_url','application_url','cv_id','cv_sha256','cv_template_version','cv_prompt_version','status','confirmation_id','latest_outcome','latest_outcome_at','notes',
    'work_format_class','office_location','onsite_frequency','employment_route','work_from_poland_allowed','relocation_required'];
  await mkdir(outputDir, { recursive: true });
  await atomicWrite(outputDir, 'applications_log.csv', [fields.join(','), ...rows.map(r => fields.map(k => csv(r[k])).join(','))].join('\n') + '\n');
  await atomicWrite(outputDir, 'APPLICATIONS_LOG.md', '# Application ledger\n\n| Applied | Company | Role | Location | Fit | Status | Source | CV | Confirmation |\n|---|---|---|---|---|---|---|---|---|\n'
    + rows.filter(r => r.status === 'SUBMITTED').map(r => '| ' + [r.submitted_at,r.company,r.title,r.location,r.fit_score,r.status,r.canonical_url,r.pdf_path,r.confirmation_id].map(md).join(' | ') + ' |').join('\n') + '\n');
  await atomicWrite(outputDir, 'weekly_conversion.json', JSON.stringify(weeklyReport, null, 2) + '\n');
  await atomicWrite(outputDir, 'summary.json', JSON.stringify(summary, null, 2) + '\n');
  if (telegram) {
    const formatted = value => `Discovered: ${value.discovered}\nUnique: ${value.unique}\nAnalyzed: ${value.analyzed}\nSuitable: ${value.suitable}\n${value.bands.map(r => `${r.decision}: ${r.count}`).join('\n')}\nSubmitted: ${value.submitted}\nAwaiting user: ${value.awaiting_user}\nManual takeover: ${value.manual_takeover}\nFailed: ${value.failed}\nSkipped: ${value.skipped}\nCVs: ${value.cvs}`;
    await telegram.send(`JobHunter daily summary — ${date} (${REPORT_TIMEZONE})\n${formatted(daily)}\nCurrent awaiting-user backlog: ${metrics.awaiting_user}\nTop rejection reasons: ${daily.top_rejection_reasons.map(r => `${r.reason}: ${r.count}`).join(', ') || 'none recorded'}\n\nCumulative through ${date}\n${formatted(cumulative)}\n\nWork-format/geography (analyzed today)\n${Object.entries(daily.work_format_geography).map(([key, count]) => `${key}: ${count}`).join('\n')}`);
    if (weekly) await telegram.send(`JobHunter weekly conversion — ${weekStart} through ${date} (${REPORT_TIMEZONE})\nSubmitted cohort and recorded stages\n${Object.entries(weeklyReport.funnel).filter(([key]) => key !== 'rates').map(([key, count]) => `${key}: ${count}`).join('\n')}\nBreakdowns: weekly_conversion.json; minimum sample ${minSample}`);
  }
  return summary;
}
