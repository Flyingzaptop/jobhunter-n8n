import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Repository } from '../services/core/repository.mjs';
import { report, warsawDate, weeklyFunnel, geographyCounts } from '../services/core/reporting.mjs';

test('Warsaw day respects midnight and both DST offsets', () => {
  assert.equal(warsawDate('2026-10-02T22:00:00Z'), '2026-10-03');
  assert.equal(warsawDate('2026-10-02T21:59:59Z'), '2026-10-02');
  assert.equal(warsawDate('2026-01-02T23:00:00Z'), '2026-01-03');
  assert.equal(warsawDate('2026-03-29T22:00:00Z'), '2026-03-30');
  assert.equal(warsawDate('2026-10-25T23:00:00Z'), '2026-10-26');
});

test('weekly conversion counts distinct recorded stages, old-cohort activity and sparse samples', () => {
  const row = (id, submitted_at, history, metadata = {}) => ({ application_id: id, status: 'SUBMITTED', submitted_at,
    outcome_history: history.map(outcome_status => ({ outcome_status, recorded_at: '2026-10-02T12:00:00Z' })), ...metadata });
  const rows = [row('new', '2026-10-01T10:00:00Z', ['RECRUITER_REPLY','RECRUITER_REPLY','OFFER'], {role_family:'engineering'}),
    row('pending', '2026-10-02T10:00:00Z', [], {role_family:'engineering'}),
    row('old', '2026-09-21T10:00:00Z', ['HR_SCREEN']),
    row('withdrawn', '2026-10-03T10:00:00Z', ['WITHDRAWN'], {role_family:'other'})];
  const result = weeklyFunnel(rows, {start:'2026-09-28',end:'2026-10-04',minSample:2});
  assert.equal(result.funnel.submitted, 3);
  assert.equal(result.funnel.recruiter_replies, 1);
  assert.equal(result.funnel.offers, 1);
  assert.equal(result.funnel.hr_screens, 0, 'offer does not infer earlier stages');
  assert.equal(result.funnel.no_response_still_pending, 1);
  assert.equal(result.funnel.withdrawals, 1);
  assert.equal(result.outcome_activity.hr_screens, 1, 'old application belongs only to outcome activity');
  assert.equal(result.funnel.rates.offers, 1/3);
  assert.equal(result.breakdowns.role_family[0].funnel.submitted, 2);
  assert.equal(result.breakdowns.role_family[1].sufficient_sample, false);
  assert.equal(result.breakdowns.role_family[1].funnel, undefined);
  assert.equal(result.breakdowns.cv_prompt_version[0].missing_metadata, true);
  assert.throws(() => weeklyFunnel(rows, {start:'2026-09-28',end:'2026-10-04',minSample:0}));
});

test('work-format geography respects policy classification and explicit authorization blockers', () => {
  const rows = ['REMOTE_WORLDWIDE_FROM_POLAND','REMOTE_EUROPE_FROM_POLAND','REMOTE_POLAND','HYBRID_WROCLAW_LOCAL',
    'ONSITE_WROCLAW_LOCAL','HYBRID_POLAND_RARE_TRAVEL','ONSITE_EUROPE_RELOCATION_REVIEW','UNKNOWN']
    .map(work_format_class => ({decision:'REVIEW',analysis_json:{work_format_class}}));
  rows.push({decision:'REJECT',analysis_json:{work_format_class:'REMOTE_COUNTRY_LOCKED_INELIGIBLE'}});
  rows.push({decision:'REJECT',analysis_json:{work_format_class:'REMOTE_POLAND',reasons:['WORK_AUTHORIZATION_IMPOSSIBLE']}});
  assert.deepEqual(geographyCounts(rows), {remote_worldwide_eu_from_poland:2,remote_poland:1,wroclaw_local_hybrid:1,
    wroclaw_local_onsite_review:1,poland_rare_travel_hybrid:1,europe_relocation_review:1,
    rejected_country_work_authorization:2,work_format_unknown_review:1});
});

test('PostgreSQL daily excludes yesterday, preserves frozen application dimensions and exports eligibility', {skip:!process.env.DATABASE_URL}, async () => {
  const repo = new Repository(), pool = repo.pool, client = await pool.connect();
  const schema = 'report_period_' + randomUUID().replaceAll('-', '');
  await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
  repo.pool = {query:(...args) => client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
  try {
    await repo.migrate();
    const job = randomUUID(), oldJob = randomUUID(), cv = randomUUID(), app = randomUUID();
    await client.query(`INSERT INTO jobs_raw(raw_id,source_name,source_url,payload_json,discovered_at) VALUES
      ($1,'fixture','https://example.invalid/today','{}','2026-10-02T22:00:00Z'),
      ($2,'fixture','https://example.invalid/yesterday','{}','2026-10-02T21:59:59Z')`, [randomUUID(),randomUUID()]);
    await client.query(`INSERT INTO jobs(job_id,canonical_url,company,title,description_text,first_seen_at) VALUES
      ($1,'https://example.invalid/job','Fixture Company','Fixture Role','Fixture job','2026-10-02T22:00:00Z'),
      ($2,'https://example.invalid/old','Old Fixture','Old Role','Old job','2026-10-02T21:59:59Z')`, [job,oldJob]);
    await client.query(`INSERT INTO job_sources(job_id,source_name,source_url,first_seen_at) VALUES($1,'fixture-source','https://example.invalid/source','2026-10-02T22:00:00Z')`,[job]);
    const analysis = {role_family:'mechanical',role_level:'junior',work_format_class:'REMOTE_POLAND',work_format:{
      office_location:'Wroclaw',onsite_days_per_week:0,employment_route:'PL_EMPLOYEE',work_from_poland_allowed:true,relocation_required:false}};
    await repo.saveAnalysis(job,{...analysis,decision:'AUTO_APPLY',overall_fit:85});
    await client.query(`UPDATE job_analysis SET created_at='2026-10-03T07:00:00Z' WHERE job_id=$1`,[job]);
    await repo.saveAnalysis(oldJob,{decision:'REJECT',overall_fit:10});
    await client.query(`UPDATE job_analysis SET created_at='2026-10-02T20:00:00Z' WHERE job_id=$1`,[oldJob]);
    await client.query(`INSERT INTO cv_versions(cv_id,job_id,profile_version,template_version,model,pdf_path,html_path,sha256,qa_json,manifest_json,created_at)
      VALUES($1,$2,'fixture-profile','template-v2','fixture','fixture.pdf','fixture.html','fixture-hash','{}',$3,'2026-10-03T07:30:00Z')`,[cv,job,{prompt_version:'prompt-v3'}]);
    await client.query(`INSERT INTO applications(application_id,candidate_profile_id,job_id,cv_id,status,started_at,updated_at,submitted_at,confirmation_id)
      VALUES($1,'fixture',$2,$3,'SUBMITTED','2026-10-03T08:00:00Z','2026-10-03T08:05:00Z','2026-10-03T08:05:00Z','FIXTURE-CONF')`,[app,job,cv]);
    // Later reanalysis must not rewrite the cohort attributes of an already submitted CV.
    await repo.saveAnalysis(job,{role_family:'changed',decision:'REJECT',overall_fit:1});
    await client.query(`UPDATE job_analysis SET created_at='2026-10-03T09:00:00Z' WHERE job_id=$1 AND analysis_json->>'role_family'='changed'`,[job]);
    for (const [status,time] of [['RECRUITER_REPLY','2026-10-03T09:00:00Z'],['OFFER','2026-10-04T09:00:00Z']]) {
      await client.query(`INSERT INTO application_outcomes(outcome_id,application_id,outcome_status,source,recorded_at) VALUES($1,$2,$3,'fixture',$4)`,[randomUUID(),app,status,time]);
    }
    const outputDir = await mkdtemp(path.join(tmpdir(),'jobhunter-period-')), messages = [];
    const result = await report(repo,{outputDir,date:'2026-10-03',minSample:1,weekly:true,telegram:{send:async message => messages.push(message)}});
    assert.equal(result.discovered,2); assert.equal(result.daily.discovered,1);
    assert.equal(result.unique,2); assert.equal(result.daily.unique,1);
    assert.equal(result.analyzed,2); assert.equal(result.daily.analyzed,1);
    assert.equal(result.daily.suitable,0); assert.equal(result.daily.submitted,1);
    assert.equal(result.weekly.period.start,'2026-09-28');
    assert.equal(result.weekly.funnel.recruiter_replies,1); assert.equal(result.weekly.funnel.offers,0);
    assert.equal(result.weekly.breakdowns.role_family[0].value,'mechanical');
    assert.equal(result.weekly.breakdowns.fit_band[0].value,'AUTO_APPLY');
    assert.equal(result.weekly.breakdowns.source[0].value,'fixture-source');
    assert.equal(result.weekly.breakdowns.cv_prompt_version[0].value,'prompt-v3');
    const csv = await readFile(path.join(outputDir,'applications_log.csv'),'utf8');
    assert.ok(csv.includes('work_format_class,office_location,onsite_frequency,employment_route,work_from_poland_allowed,relocation_required'));
    assert.ok(csv.includes('"REMOTE_POLAND","Wroclaw","0 days/week","PL_EMPLOYEE","true","false"'));
    assert.ok(messages[0].includes('daily summary — 2026-10-03')); assert.ok(messages[0].includes('Cumulative through 2026-10-03'));
    assert.equal(messages.length,2);
    await report(repo,{outputDir,date:'2026-10-03',minSample:1});
    assert.equal(await readFile(path.join(outputDir,'applications_log.csv'),'utf8'),csv);
    assert.equal((await readdir(outputDir)).filter(name => name.endsWith('.tmp')).length,0);
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`); client.release(); await pool.end();
  }
});
