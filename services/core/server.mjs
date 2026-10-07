import http from "node:http";
import { readFile } from "node:fs/promises";
import { timingSafeEqual, randomUUID, createHash } from "node:crypto";
import YAML from "yaml";
import { Repository } from "./repository.mjs";
import { discoverSources } from "./discovery.mjs";
import { normalizeRawRecords } from "./normalization.mjs";
import { analyzeJob } from "./fit.mjs";
import { OllamaClient } from "./llm.mjs";
import { createCv } from "./cv.mjs";
import { report } from "./reporting.mjs";
import { Telegram } from "./telegram.mjs";
import { runApplication, reverify, BrowserClient } from "./application.mjs";
import {reconcile} from './reconciliation.mjs';
import {runObserved,observe} from './observability.mjs';
import {retryPlan} from './analysis-retry.mjs';
import {computePriority} from './priority.mjs';
import {dispatchQuestionAnswer} from './hitl.mjs';
import {browserConfig} from '../browser-service/server.mjs';
import {withExclusiveLocalGpu} from './gpu-lock.mjs';
import {dispatchCaptchaTelegramReply,sendCaptchaQueue} from './captcha-telegram.mjs';
const load = async (p) => YAML.parse(await readFile(p, "utf8"));
const secretEqual = (a, b) => {
  const x = Buffer.from(a ?? ""),
    y = Buffer.from(b ?? "");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};
export function createCore({
  repository = new Repository(),
  token = process.env.CORE_SERVICE_TOKEN,
  host = process.env.HOST ?? "127.0.0.1",
  port = 3000,
  configDir = "config",
  testProfilePath = null,
  testMode = false,
  reportOutputDir = "data/exports",
  telegramAdapter = null,
  browserClient = null,
  applicationConfig = null,
  answerMemoryOverride = null,
  cvOutputDir = "data/cv",
  requireCvReverification = !testMode,
} = {}) {
  if(!testMode&&process.env.READINESS_REAL_SUBMIT_LOCK==='true'&&(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT==='true'))throw new Error('Readiness run requires DRY_RUN=true and ALLOW_REAL_SUBMIT=false');
  if ((browserClient || applicationConfig || answerMemoryOverride) && !testMode)
    throw new Error("Test adapters forbidden in production");
  if (!token) throw new Error("CORE_SERVICE_TOKEN required");
  const telegram = new Telegram();
  const llm = new OllamaClient();
  async function executeStage(number, body = {}) {
    if (number === 1) {
      if (body.fixture) {
        if (!testMode) throw new Error("Fixtures forbidden in production");
        const { fixtureRecords } = await import(
          "../../tests/fixtures/discovery-helper.mjs"
        );
        const records = await fixtureRecords();
        const ids = [];
        for (const record of records)
          ids.push((await repository.insertRaw(record)).raw_id);
        return { raw_ids: ids, discovered: ids.length, errors: [] };
      }
      const registry = await load(`${configDir}/source_registry.yaml`);
      if(!testMode&&process.env.DISCOVERY_V2_ENABLED!=='false'){
        const {runMarketDiscovery}=await import('./discovery-v2.mjs');
        return runMarketDiscovery({repository,observer:event=>observe(repository,event)});
      }
      const sourceProfile = body.profile ?? "real";
      if(sourceProfile !== "real" && !(testMode && sourceProfile === "mock"))
        throw new Error("Mock source profile forbidden in production");
      const sources = registry.sources
        .filter((s) => (s.profile ?? "real") === sourceProfile)
        .map((s) => ({ ...registry.defaults, ...s }));
      return discoverSources({ sources, repository,logger:event=>observe(repository,{...event,message:`Scanning ${event.source_name}`}).catch(()=>{}) });
    }
    if (number === 2)
      return normalizeRawRecords({
        records: await repository.listRaw(),
        repository,
      });
    if (number === 3) {
      const profile = await load(
        testProfilePath ?? `${configDir}/candidate_profile.yaml`,
      );
      const policy = await load(`${configDir}/search_policy.yaml`);
      policy.thresholds = {...policy.thresholds,
        auto_apply: Number(process.env.AUTO_APPLY_MIN_SCORE ?? policy.thresholds?.auto_apply ?? 78),
        review: Number(process.env.REVIEW_MIN_SCORE ?? policy.thresholds?.review ?? 60),
        stretch: Number(process.env.STRETCH_MIN_SCORE ?? policy.thresholds?.stretch ?? 45)};
      const limit = Math.min(Math.max(Number(body.limit ?? process.env.ANALYSIS_BATCH_SIZE ?? 3),1),50);
      if(!Number.isInteger(limit))throw new Error("Invalid analysis batch limit");
      const jobs = (await repository.listCanonicalJobs()).filter(job =>
        (!body.job_ids || body.job_ids.includes(job.job_id)) &&
        (body.reanalyze || (!['ANALYSIS_FAILED','ANALYSIS_DEAD_LETTER'].includes(job.status)&&(!job.next_analysis_retry_at||new Date(job.next_analysis_retry_at)<=new Date()))));
      const results = [];
      for (const job of jobs) {
        if(results.length >= limit)break;
        const exists = (
          await repository.pool.query(
            "SELECT 1 FROM job_analysis WHERE job_id=$1 LIMIT 1",
            [job.job_id],
          )
        ).rowCount;
        if (exists && !body.reanalyze) continue;
        await repository.pool.query('UPDATE jobs SET analysis_attempt_count=analysis_attempt_count+1 WHERE job_id=$1',[job.job_id]);
        await observe(repository,{event:'FIT_ANALYSIS_STARTED',entity_type:'job',entity_id:job.job_id,message:`Reading requirements: ${job.company} — ${job.title}`,processed_count:results.length,total_count:Math.min(jobs.length,limit)});
        try {
          if(!testMode&&/greenhouse|lever|ashby|smartrecruiters/i.test([job.ats_identity,job.metadata?.adapter,job.canonical_url].filter(Boolean).join(' '))){
            const {reverifyMarketJob}=await import('./discovery-v2.mjs');const verification=await reverifyMarketJob({job,repository});
            if(verification.job)Object.assign(job,verification.job);
            job.availability_status=verification.status;
            if(verification.status==='UNKNOWN')await repository.pool.query("UPDATE jobs SET availability_status='UNKNOWN' WHERE job_id=$1",[job.job_id]);
            if(verification.status==='CLOSED'){await repository.event('job',job.job_id,'SKIPPED_CLOSED');results.push({job_id:job.job_id,status:'CLOSED'});continue;}
          }
          const analysis = await analyzeJob({ job, profile, policy, llm });
          analysis.model = analysis.analysis_method==='DETERMINISTIC_HARD_GATE'?null:llm.model;
          analysis.profile_version = profile.profile_version ?? createHash('sha256').update(JSON.stringify(profile)).digest('hex');
          Object.assign(analysis,computePriority({job,analysis,policy}));
          analysis.runtime_statistics=analysis.analysis_method==='DETERMINISTIC_HARD_GATE'?null:llm.lastStats??null;
          analysis.profile_hash=createHash('sha256').update(JSON.stringify(profile)).digest('hex');
          analysis.job_content_hash=job.content_hash;
          await repository.saveAnalysis(job.job_id, analysis);
          await repository.pool.query("UPDATE jobs SET status='ANALYZED',last_analysis_error=NULL,next_analysis_retry_at=NULL,analysis_failure_kind=NULL WHERE job_id=$1",[job.job_id]);
          await repository.event('job',job.job_id,'ANALYZED',{decision:analysis.decision,overall_fit:analysis.overall_fit,application_priority:analysis.application_priority,model:analysis.model,prompt_version:analysis.prompt_version,validation_state:'VALID',runtime_statistics:analysis.runtime_statistics});
          results.push({
            job_id: job.job_id,
            decision: analysis.decision,
            overall_fit: analysis.overall_fit,
          });
        } catch (e) {
          const attempts=(await repository.pool.query('SELECT analysis_attempt_count FROM jobs WHERE job_id=$1',[job.job_id])).rows[0].analysis_attempt_count;
          const plan=retryPlan(e,attempts);
          await repository.pool.query("UPDATE jobs SET status=$2,last_analysis_error=$3,next_analysis_retry_at=$4,analysis_failure_kind=$5 WHERE job_id=$1",[job.job_id,plan.status,e.message.slice(0,240),plan.next_retry_at,plan.kind]);
          await repository.event("job", job.job_id, "ANALYSIS_FAILED", {
            error: e.name,
            ...(e.name === 'StructuredOutputError' ? {diagnostic:e.message.slice(0,240)} : {}),
          });
          results.push({ job_id: job.job_id, error: e.name,
            ...(e.name === 'StructuredOutputError' ? {diagnostic:e.message.slice(0,240)} : {}) });
        }
      }
      return { attempted: results.length, analyzed: results.filter(r=>r.decision&&!r.error).length, results };
    }
      if (number === 4) {
      const profile = await load(
        testProfilePath ?? `${configDir}/candidate_profile.yaml`,
      );
      if (!body.job_id) {
        if((testMode||process.env.CV_FACTORY_V2_ENABLED==='false')&&(!profile.onboarding?.legal_name || profile.onboarding.legal_name==='UNKNOWN'))
          return {generated:0,blocked_reason:'ONBOARDING_REQUIRED',pending_fields:['legal_name']};
        const queued=(await repository.pool.query(`SELECT j.job_id FROM jobs j JOIN LATERAL
          (SELECT decision FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC LIMIT 1) a ON true
          WHERE a.decision='AUTO_APPLY' AND j.availability_status='OPEN'
          AND NOT EXISTS(SELECT 1 FROM cv_versions c WHERE c.job_id=j.job_id)
          ORDER BY j.first_seen_at LIMIT 3`)).rows;
        const results=[];
        for(const item of queued){try{results.push({job_id:item.job_id,manifest:await stage(4,{job_id:item.job_id})});}
          catch(error){await repository.event('job',item.job_id,'CV_GENERATION_FAILED',{error:error.name});results.push({job_id:item.job_id,error:error.message});}}
        return {generated:results.filter(r=>!r.error).length,results};
      }
      const row = !testMode ? (await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[body.job_id])).rows[0] : null;
      const job = !testMode ? row&&({...row.metadata,...row}) : (await repository.listCanonicalJobs()).find(j=>j.job_id===body.job_id);
      if (!job) throw new Error("Job missing");
      if(requireCvReverification && (testMode||process.env.CV_FACTORY_V2_ENABLED==='false') && process.env.VACANCY_REVERIFY_BEFORE_CV !== 'false'){
        const open = await reverify({browser:browserClient??new BrowserClient(),job,applicationId:`cv-${job.job_id}`});
        if(!open)throw new Error('Vacancy could not be reverified open before CV');
        await repository.pool.query('UPDATE jobs SET last_verified_open_at=now(),availability_status=\'OPEN\' WHERE job_id=$1',[job.job_id]);
        job.availability_status='OPEN';
      }
      const { rows } = await repository.pool.query(
        "SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1",
        [job.job_id],
      );
      if (!rows[0]) throw new Error("Job analysis missing");
      if(!testMode&&process.env.CV_FACTORY_V2_ENABLED!=='false'){
        if(!body.prepare_cv){const {reverifyMarketJob}=await import('./discovery-v2.mjs');const verified=await reverifyMarketJob({job,repository});
        if(verified.status!=='OPEN')throw new Error('Current official vacancy is not verified OPEN');
        if(verified.job)Object.assign(job,verified.job);
        job.availability_status='OPEN';}
        await observe(repository,{event:'CV_WRITING',entity_type:'job',entity_id:job.job_id,message:`Tailoring verified facts for ${job.title}`});
        const {buildTailoredCv}=await import('./cv-v2.mjs');return buildTailoredCv({job,profile,analysis:rows[0].analysis_json,llm,repository,outputRoot:'data/cv-v2',allowUnverifiedSource:body.prepare_cv===true});
      }
      return createCv({
        job,
        profile,
        analysis: rows[0].analysis_json,
        repository,
        outputRoot: cvOutputDir,
      });
    }
    if (number === 5) {
      if(!testMode && process.env.APPLICATION_FILL_ENABLED!=='true')
        return {started:0,blocked_reason:'APPLICATION_FILL_DISABLED'};
      if(!body.job_id){
        const queued=(await repository.pool.query(`SELECT j.job_id FROM jobs j JOIN LATERAL
          (SELECT decision FROM job_analysis WHERE job_id=j.job_id ORDER BY created_at DESC LIMIT 1) a ON true
          WHERE a.decision='AUTO_APPLY' AND EXISTS(SELECT 1 FROM cv_versions c WHERE c.job_id=j.job_id AND c.qa_json->>'pass'='true')
          AND NOT EXISTS(SELECT 1 FROM applications app WHERE app.job_id=j.job_id)
          ORDER BY j.first_seen_at LIMIT 3`)).rows;
        const results=[];for(const row of queued)results.push(await stage(5,{job_id:row.job_id}));
        return {started:results.length,results};
      }
      const profile = await load(
        testProfilePath ?? `${configDir}/candidate_profile.yaml`,
      );
      let memory = answerMemoryOverride ?? {};
      if (!answerMemoryOverride) {
        try {
          memory = await load(`${configDir}/answer_memory.yaml`);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      const result = await runApplication({
        repository,
        jobId: body.job_id,
        applicationId: body.application_id,
        profile,
        answerMemory: memory,
        telegram: telegramAdapter ?? telegram,
        ...(browserClient ? { browser: browserClient } : {}),
        ...(applicationConfig ? { config: applicationConfig } : {}),
      });
      if (result.status === "SUBMITTED") {
        await report(repository, { outputDir: reportOutputDir });
      }
      return result;
    }
    if (number === 6) {
      const reconciliation = await reconcile(repository);
      const summary = await report(repository, {
        outputDir: reportOutputDir,
        weekly:body.weekly===true || (!testMode && process.env.WEEKLY_FUNNEL_ENABLED!=='false' && new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Warsaw',weekday:'short'}).format(new Date())==='Mon'),
        telegram:
          telegramAdapter ??
          (!testMode && process.env.TELEGRAM_BOT_TOKEN ? telegram : undefined),
      });
      return {...summary,reconciliation};
    }
    throw new Error("Unknown stage");
  }
  async function stage(number,body={}){
    if(!Number.isInteger(number)||number<1||number>6)throw new Error('Invalid stage');
    return runObserved(repository,number,body,async()=>{
      if(number<6&&(await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused)return {blocked_reason:'PAUSED',processed:0};
      if(!testMode&&(number===3||(number===4&&body.job_id))){
        return withExclusiveLocalGpu(repository,()=>executeStage(number,body));
      }
      return executeStage(number,body);
    },{trigger:'n8n',mode:testMode?'MOCK':'REAL'});
  }
  const telegramService=telegramAdapter??telegram;
  async function dispatchTelegram(accepted){
    if(accepted.command==='/operator_message')return {status:'SAVED_FOR_OPERATOR',message_id:accepted.operator_message_id};
    if(accepted.command==='/reject_application'){
      const profile=await load(`${configDir}/candidate_profile.yaml`);
      const {rejectPreparedApplication}=await import('./application-rejection.mjs');
      const result=await rejectPreparedApplication({repository,applicationId:accepted.application_id,profileId:profile.profile_id,reason:accepted.rejection_reason,source:'USER_TELEGRAM',approvalId:accepted.approval_id,bindingDigest:accepted.binding_digest});
      const {escapeTelegram}=await import('./telegram-applications.mjs');
      await telegramService.sendHtml(`<b>Заявка отклонена</b>\n\n${escapeTelegram(result.reason??accepted.rejection_reason)}\n\nПодтверждение отправки аннулировано.\n<code>${accepted.application_id.slice(0,8)}</code>`);return result;
    }
    if(accepted.command==='/confirm_submit'){
      const profile=await load(`${configDir}/candidate_profile.yaml`);
      const {dispatchTelegramSubmit}=await import('./telegram-applications.mjs');
      return dispatchTelegramSubmit({repository,profile,browser:browserClient??new BrowserClient(),telegram:telegramService,accepted});
    }
    if(accepted.captcha_handoff_id){const profile=await load(testProfilePath??`${configDir}/candidate_profile.yaml`);return dispatchCaptchaTelegramReply({repository,browser:browserClient??new BrowserClient(),telegram:telegramService,accepted,profileId:profile.profile_id});}
    if(accepted.command==='/captcha_queue'||accepted.command==='/start'){const profile=await load(testProfilePath??`${configDir}/candidate_profile.yaml`);return sendCaptchaQueue(repository,telegramService,{profileId:profile.profile_id});}
    if(accepted.command==='/captcha_transport_reply'){await telegramService.send(`[TRANSPORT_TEST] Request ${accepted.transport_request_id.slice(0,8)}: ${accepted.transport_valid?'your photo reply matched its code.':'that code does not match this photo. Please reply to the correct photo and try again.'} No real CAPTCHA was verified and no application changed.`);return {scope:'TRANSPORT_TEST',code_valid:accepted.transport_valid};}
    if(accepted.application_id){
      const row=(await repository.pool.query('SELECT job_id FROM applications WHERE application_id=$1',[accepted.application_id])).rows[0];
      if(!row)throw new Error('Correlated application missing');
      if(accepted.question_id){const dispatched=await dispatchQuestionAnswer(repository,accepted.question_id,()=>resumeAnsweredApplication(accepted.application_id));return dispatched.result??dispatched;}
      return resumeAnsweredApplication(accepted.application_id);
    }
    if(accepted.command==='/summary')accepted={...accepted,command:'/status'};
    if(accepted.command==='/weekly')return stage(6,{weekly:true});
    if(accepted.command==='/status'){
      const {searchCounts,countsHtml}=await import('./telegram-applications.mjs');
      const profile=await load(`${configDir}/candidate_profile.yaml`);
      const rows=(await repository.pool.query('SELECT status,count(*)::int AS count FROM applications GROUP BY status')).rows;
      const paused=(await repository.pool.query('SELECT paused FROM runtime_control WHERE id=true')).rows[0]?.paused;
      await telegramService.sendHtml(`${countsHtml(await searchCounts(repository,profile))}\n\nПоиск: ${paused?'приостановлен':'работает'}`);
      return {paused:Boolean(paused),statuses:rows};
    }
    if(['/pause','/resume'].includes(accepted.command))await telegramService.send(accepted.command==='/pause'?'JobHunter paused. Saved application state is retained.':'JobHunter resumed. Queue processing is enabled.');
    return accepted;
  }
  async function resumeAnsweredApplication(applicationId){
    const row=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1',[applicationId])).rows[0];
    if(!row)throw new Error('Correlated application missing');
    if(row.last_state?.preparation_only===true){
      if(process.env.DRY_RUN!=='true'||process.env.ALLOW_REAL_SUBMIT==='true')throw new Error('Preparation resume requires dry-run');
      const profile=await load(`${configDir}/candidate_profile.yaml`);
      const {reverifyMarketJob}=await import('./discovery-v2.mjs');
      return runObserved(repository,5,{application_id:applicationId},()=>runApplication({repository,jobId:row.job_id,applicationId,profile,telegram:telegramService,
        config:{...browserConfig(),dryRun:true,allowRealSubmit:false,enabled:true},
        verifyOpen:async({job})=>(await reverifyMarketJob({job,repository})).status==='OPEN'}),{trigger:'controlled-preparation',mode:'REAL'});
    }
    return stage(5,{job_id:row.job_id,application_id:applicationId});
  }
  const server = http.createServer(async (req, res) => {
    const runId = randomUUID();
    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ run_id: runId, ...data }));
    };
    try {
      if (req.method === "GET" && req.url === "/health") {
        await repository.pool.query("SELECT 1");
        return send(200, { ok: true, service: "core" });
      }
      if (!secretEqual(req.headers["x-jobhunter-token"], token))
        return send(401, { error: "Unauthorized" });
      let text = "";
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 100000) throw new Error("Request too large");
      }
      const body = text ? JSON.parse(text) : {};
      if(req.method==='POST'&&req.url==='/hitl/dispatch'){
        if(Object.keys(body).some(k=>k!=='question_id'))throw new Error('Invalid HITL dispatch body');
        const result=await dispatchQuestionAnswer(repository,body.question_id,receipt=>resumeAnsweredApplication(receipt.application_id));
        return send(200,{ok:true,result});
      }
      if(req.method==='POST'&&req.url==='/hitl/recover'){
        const pending=(await repository.pool.query("SELECT question_id FROM application_answer_receipts WHERE dispatch_status='PENDING' ORDER BY created_at LIMIT 20")).rows;
        const results=[];for(const row of pending)results.push(await dispatchQuestionAnswer(repository,row.question_id,receipt=>resumeAnsweredApplication(receipt.application_id)));
        return send(200,{ok:true,result:{results}});
      }
      if (req.method === "POST" && /^\/stages\/[1-6]$/.test(req.url)) {
        const result = await stage(Number(req.url.at(-1)), body);
        return send(200, { ok: true, result });
      }
      if (req.method === "POST" && req.url === "/telegram/update") {
        const result=await telegramService.processUpdate(repository,body,dispatchTelegram);
        return send(200,{ok:true,result});
      }
      if(req.method==='POST'&&req.url==='/telegram/recover')return send(200,{ok:true,result:await telegramService.recoverPending(repository,dispatchTelegram,{limit:body.limit??20})});
      return send(404, { error: "Not found" });
    } catch (e) {
      console.error(
        JSON.stringify({
          run_id: runId,
          event: "request_failed",
          error: e.name,
          message: e.message,
        }),
      );
      send(400, { ok: false, error: e.message });
    }
  });
  return {
    server,
    stage,
    repository,
    async start() {
      await repository.migrate();
      return new Promise((resolve) => server.listen(port, host, resolve));
    },
    async stop() {
      await new Promise((r) => server.close(r));
      await repository.close();
    },
  };
}
if (
  import.meta.url === new URL(process.argv[1], "file:///").href ||
  process.argv[1]?.replaceAll("\\", "/").endsWith("/services/core/server.mjs")
) {
  const core = createCore();
  await core.start();
  console.log("JobHunter core listening on port 3000");
}
