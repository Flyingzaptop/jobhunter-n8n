import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { validateDestination, controlledSubmitPermission, classifyConsent } from './policy.mjs';
import { pruneBrowserState } from './retention.mjs';
import {atsAdapterFor,reviewedReadPost,safeNavigationButton,observerUrl,finalSubmitLabel} from './ats-adapters.mjs';
import {captureCaptchaImage} from './captcha-image.mjs';
import {humanCaptchaView,humanCaptchaClick,inspectHumanCaptchaCompletion,reviewedHumanCaptchaPost,captchaObserverUrl,observePendingCaptcha} from './human-captcha.mjs';
import {verifySubmitCapability} from './submit-capability.mjs';
import {reviewedUploadRequest,draftNavigationWindow,reviewedDraftRequest,verifiedUploadReceipt} from './preparation-network.mjs';
import {selectedCookieButton} from '../core/form-settling.mjs';
import {dismissPracaCookies,dismissPracaUploadError} from './praca-cookies.mjs';
import {setCheckedControl} from './check-control.mjs';
import {boardForUrl,exportedBoardState} from '../core/board-profiles.mjs';
import {reviewedAshbyGeoRead,reviewedAshbyUploadInit,reviewedAshbyFileAttach,reviewedAshbyFieldSave,bindAshbyStorageUpload,reviewedAshbyStoragePost,restoreOmittedMultipartPdf,chooseCombobox} from './ashby-preparation.mjs';
import {gunzipSync,brotliDecompressSync,inflateSync} from 'node:zlib';

const hash = value => createHash('sha256').update(value).digest('hex');
export function browserConfig(env = process.env) {
  return { token: env.BROWSER_SERVICE_TOKEN || '', port: Number(env.BROWSER_SERVICE_PORT || 3001), host: env.BIND_HOST || '127.0.0.1',
    enabled: env.JOBHUNTER_ENABLED !== 'false', dryRun: env.READINESS_REAL_SUBMIT_LOCK==='true'||env.DRY_RUN !== 'false', allowRealSubmit: env.READINESS_REAL_SUBMIT_LOCK!=='true'&&env.ALLOW_REAL_SUBMIT === 'true', allowMockSubmit: env.ALLOW_MOCK_SUBMIT === 'true',
    allowMockNetwork: env.ALLOW_MOCK_NETWORK === 'true', mockHosts: (env.MOCK_ALLOWED_HOSTS || '127.0.0.1,localhost,mock-job-board').split(','),
    allowDomains: (env.APPLICATION_DOMAIN_ALLOWLIST || '').split(',').filter(Boolean), denyDomains: (env.APPLICATION_DOMAIN_DENYLIST || '').split(',').filter(Boolean),
    artifactRoot: path.resolve(env.ARTIFACT_DIR || 'data/cv'), stateRoot: path.resolve(env.BROWSER_STATE_DIR || 'data/browser'), maxRecovery: Number(env.MAX_BROWSER_RECOVERY_ATTEMPTS || 2),
    sessionRetentionHours:Number(env.BROWSER_SESSION_RETENTION_HOURS||48),screenshotRetentionHours:Number(env.SCREENSHOT_RETENTION_HOURS||168),executablePath: env.PLAYWRIGHT_EXECUTABLE_PATH || undefined };
}

// Every request is resolved once, checked, then connected to the checked address.
// Redirects return to Chromium and traverse this policy again. No DNS rebinding gap.
async function pinnedRequest(request, destination, bodyOverride) {
  const headers = { ...request.headers() }; delete headers.host;
  const body = bodyOverride??request.postDataBuffer();if(Buffer.isBuffer(body))headers['content-length']=String(body.length);
  return new Promise((resolve, reject) => {
    const transport = destination.url.protocol === 'https:' ? https : http;
    const outgoing = transport.request(destination.url, { method: request.method(), headers,
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [{ address: destination.address, family: destination.family }]) : callback(null, destination.address, destination.family),
      timeout: 20000 }, incoming => {
      const chunks = []; let size = 0;
      incoming.on('data', chunk => { size += chunk.length; if (size > 20 * 1024 * 1024) incoming.destroy(new Error('RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
      incoming.on('error', reject); incoming.on('end', () => {
        const replyHeaders = {}; for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined && !['transfer-encoding', 'connection'].includes(key)) replyHeaders[key] = Array.isArray(value) ? value.join('\n') : String(value);
        resolve({ status: incoming.statusCode, headers: replyHeaders, body: Buffer.concat(chunks) });
      });
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('NETWORK_TIMEOUT'))); outgoing.on('error', reject); if (body) outgoing.write(body); outgoing.end();
  });
}

async function bodyJSON(req) { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 256000) throw new Error('BODY_TOO_LARGE'); } return text ? JSON.parse(text) : {}; }
function authorized(req, token) { const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(req.headers.authorization || ''); return Boolean(token) && actual.length === expected.length && timingSafeEqual(actual, expected); }

export async function createBrowserService(config = browserConfig()) {
  if (!config.token) throw new Error('BROWSER_SERVICE_TOKEN_REQUIRED');
  const sessions = new Map(); let browser;
  await fs.mkdir(config.stateRoot, { recursive: true }); await fs.mkdir(config.artifactRoot, { recursive: true });
  await pruneBrowserState({root:config.stateRoot,sessionHours:config.sessionRetentionHours??48,screenshotHours:config.screenshotRetentionHours??168});
  const retentionTimer=setInterval(()=>pruneBrowserState({root:config.stateRoot,sessionHours:config.sessionRetentionHours??48,screenshotHours:config.screenshotRetentionHours??168,activeSessionIds:new Set(sessions.keys())}).catch(()=>{}),3600000);retentionTimer.unref();
  async function newSession(applicationId, saved,board) {
    browser ||= await chromium.launch({ headless: true, executablePath: config.executablePath, args: ['--disable-gpu','--disable-webrtc', '--disable-quic'] });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, storageState: saved?.storage_state??await exportedBoardState(board) });
    const session = { id: randomUUID(), application_id: applicationId, context, history: saved?.action_history || [], uploads: saved?.uploaded_file_hashes || [], pending_question: saved?.pending_question || null, submit_attempted: saved?.submit_attempted || false, submission_confirmation: saved?.submission_confirmation || null, recovery_attempts: saved?.recovery_attempts || 0, submitActive: false, blocked_requests: [], filled_fields: saved?.filled_fields || {} };
    await context.route('**/*', async route => {
      try {
        const request = route.request(), destination = await validateDestination(request.url(), config);let uploadInit=false;
        const requestBody=session.uploadWindow?.expires_at>Date.now()||session.submitActive?restoreOmittedMultipartPdf(request.postDataBuffer(),request.headers()['content-type'],session.uploadWindow):request.postDataBuffer();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          const safeMockWrite = destination.mock && /^\/(draft|step|captcha)(\/|$)/.test(destination.url.pathname);
          const adapter=atsAdapterFor(session.page?.url()??request.url());
          const reviewed=request.method()==='POST'&&(reviewedReadPost({url:request.url(),body:request.postData(),adapter}).allowed||adapter==='ashby'&&reviewedAshbyGeoRead({url:request.url(),body:request.postData()}));
          const humanVerification=request.method()==='POST'&&reviewedHumanCaptchaPost(request.url(),session.humanCaptchaWindow,config);
          const upload=reviewedUploadRequest({url:request.url(),method:request.method(),body:requestBody,contentType:request.headers()['content-type'],window:session.uploadWindow});
          uploadInit=request.method()==='POST'&&reviewedAshbyUploadInit({url:request.url(),body:request.postData(),window:session.uploadWindow});
          const storage=reviewedAshbyStoragePost({url:request.url(),method:request.method(),body:requestBody,contentType:request.headers()['content-type'],storage:session.uploadWindow?.storage});
          const attach=request.method()==='POST'&&reviewedAshbyFileAttach({url:request.url(),body:request.postData(),window:session.uploadWindow,definitions:session.ashbyDefinitions});
          const fieldSave=request.method()==='POST'&&reviewedAshbyFieldSave({url:request.url(),body:request.postData(),windows:session.ashbyFieldWindows,definitions:session.ashbyDefinitions,suggestions:session.ashbySuggestions});
          const draft=reviewedDraftRequest({url:request.url(),method:request.method(),body:request.postDataBuffer(),contentType:request.headers()['content-type'],window:session.draftWindow});
          if (!safeMockWrite && !reviewed && !humanVerification && !upload && !uploadInit && !storage && !attach && !fieldSave && !draft && !session.submitActive) throw new Error('WRITE_REQUIRES_SUBMIT_GATE');
          if (session.submitActive && new URL(session.page.url()).origin !== destination.url.origin) throw new Error('CROSS_ORIGIN_WRITE_BLOCKED');
        }
        const reply=await pinnedRequest(request,destination,requestBody);
        if(request.method()==='POST'&&reviewedAshbyGeoRead({url:request.url(),body:request.postData()})&&reply.status===200){try{let bytes=reply.body;const encoding=reply.headers['content-encoding'];if(encoding==='gzip')bytes=gunzipSync(bytes);else if(encoding==='br')bytes=brotliDecompressSync(bytes);else if(encoding==='deflate')bytes=inflateSync(bytes);session.ashbySuggestions=JSON.parse(bytes.toString('utf8')).data?.result?.suggestions??[];}catch{session.ashbySuggestions=[];}}
        if(request.url().includes('op=ApiJobPosting')&&reply.status===200){try{let bytes=reply.body;const encoding=reply.headers['content-encoding'];if(encoding==='gzip')bytes=gunzipSync(bytes);else if(encoding==='br')bytes=brotliDecompressSync(bytes);else if(encoding==='deflate')bytes=inflateSync(bytes);const job=JSON.parse(bytes.toString('utf8')).data?.jobPosting;
          session.ashbyDefinitions??=new Set();for(const form of [job?.applicationForm,...(job?.surveyForms??[])])if(typeof form?.sourceFormDefinitionId==='string')session.ashbyDefinitions.add(form.sourceFormDefinitionId);
        }catch{/* Only observed public form definitions can authorize an attachment. */}}
        if(uploadInit&&reply.status>=200&&reply.status<300){let bytes=reply.body;const encoding=reply.headers['content-encoding'];if(encoding==='gzip')bytes=gunzipSync(bytes);else if(encoding==='br')bytes=brotliDecompressSync(bytes);else if(encoding==='deflate')bytes=inflateSync(bytes);
          const storage=bindAshbyStorageUpload(session.uploadWindow,JSON.parse(bytes.toString('utf8')));if(!storage)throw Error('ASHBY_STORAGE_WINDOW_UNVERIFIED');session.uploadWindow.storage=storage;}
        await route.fulfill(reply);
      } catch (error) {
        const rejected=route.request();let operationName;
        try{const json=JSON.parse(rejected.postData()??'');if(typeof json.operationName==='string'&&/^[A-Za-z0-9_]{1,100}$/.test(json.operationName))operationName=json.operationName;}catch{}
        session.blocked_requests.push({reason:error.message,url:captchaObserverUrl(rejected.url())??observerUrl(rejected.url()),method:rejected.method(),...(operationName?{operation_name:operationName}:{}),timestamp:new Date().toISOString()});
        await route.abort('blockedbyclient').catch(()=>{});
      }
    });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
    context.on('page', async page => {if(!session.page||page===session.page)return;
      if(!session.readNavigationUntil||Date.now()>session.readNavigationUntil){await page.close().catch(()=>{});return;}
      try{await page.waitForLoadState('domcontentloaded',{timeout:10000});
        const target=await validateDestination(page.url(),config);
        if(target.url.protocol!=='https:'||atsAdapterFor(target.url.href)==='generic')throw new Error('UNREVIEWED_APPLICATION_POPUP');
        session.page=page;session.readNavigationUntil=null;
      }catch{await page.close().catch(()=>{});}
    });
    session.page = await context.newPage(); session.page.setDefaultTimeout(7000); sessions.set(session.id, session); return session;
  }
  async function snapshot(session) {
    const result = await session.page.evaluate(() => {
      const visible = e => Boolean(e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
      const selector = e => e.id ? '#' + CSS.escape(e.id) : e.name ? `${e.tagName.toLowerCase()}[name=${JSON.stringify(e.name)}]` : `[data-jh-index="${e.dataset.jhIndex}"]`;
      const fields = [...document.querySelectorAll('input,select,textarea')].map((e, index) => { e.dataset.jhIndex = String(index); return { selector: selector(e), name: e.name, type: e.type || e.tagName.toLowerCase(), field_path:e.closest('[data-field-path]')?.dataset.fieldPath??null, form_render_id:e.closest('[data-field-entry-id]')?.dataset.fieldEntryId?.slice(0,36)??null, role:e.getAttribute('role'), description:e.closest('[data-field-entry-id]')?.querySelector('.ashby-application-form-question-description')?.textContent?.trim()??'', group_label:e.closest('[data-field-entry-id]')?.querySelector('.ashby-application-form-question-title')?.textContent?.trim()??'', label: [...(e.labels || [])].map(l => l.textContent.trim()).join(' ') || e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ') || e.closest('[data-field-entry-id]')?.querySelector('.ashby-application-form-question-title')?.textContent?.trim() || e.placeholder || '', required: e.required || e.getAttribute('aria-required') === 'true' || [...(e.closest('[data-field-entry-id]')?.querySelector('.ashby-application-form-question-title')?.classList??[])].some(c=>/^_required_[a-z0-9]+_\d+$/i.test(c)), max_length:e.maxLength>0?e.maxLength:null, pattern:e.pattern||null,autocomplete:e.autocomplete||null, disabled:Boolean(e.disabled),readOnly:Boolean(e.readOnly),form:e.form?[...document.forms].indexOf(e.form):null,form_id:e.form?.id??null, form_action:e.form?.action??null, form_method:e.form?.method??null, visible: visible(e), value: /password|otp|totp|authentication|csrf|secret/i.test(e.type+' '+e.name)||e.autocomplete==='one-time-code'?'':/^(?:g-recaptcha-response|h-captcha-response|cf-turnstile-response|frc-captcha-solution|captcha[_-]?(?:token|response)|(?:re|h)captchaToken)$/i.test(e.name)?'':e.type === 'file' ? [...e.files].map(f => f.name).join(',') : e.value, checked: e.checked, multiple: Boolean(e.multiple), options: e.options ? [...e.options].map(o => ({ value: o.value, label: o.textContent, selected: o.selected })) : undefined, validation_message: e.validationMessage || '' }; });
      const buttons = [...document.querySelectorAll('button,input[type=submit],a')].filter(visible).map((e, index) => { if (!e.id) e.dataset.jhIndex = `b${index}`; return { selector: selector(e), text: e.textContent.trim() || e.value || '', type: e.type || 'link',name:e.name??null,value:e.value??null,formAction:e.formAction??null,form_id:e.form?.id??null, final_submit: e.dataset.finalSubmit === 'true', href: e.href || null,disabled:Boolean(e.disabled),form_action:e.getAttribute('formaction')||e.form?.action||null,form_method:e.getAttribute('formmethod')||e.form?.method||null }; });
      return { url: location.href, title: document.title, forms:[...document.forms].map(f=>({id:f.id||null,name:f.name||null,action:f.action,method:f.method,enctype:f.enctype})), current_step: Number(document.querySelector('[data-step]')?.dataset.step || 0), draft_id: document.querySelector('[data-draft]')?.dataset.draft || null, fields, buttons, text: (document.body?.innerText || '').slice(0, 16000), captcha: Boolean(document.querySelector('[data-captcha],iframe[src*="captcha"],.g-recaptcha,.h-captcha')), confirmation_id: document.querySelector('[data-confirmation-id]')?.dataset.confirmationId || null, validation_errors: [...document.querySelectorAll('[role=alert],.error')].map(e => e.textContent.trim()).filter(Boolean) };
    });
    const humanCompletion=session.humanCaptchaAction?await inspectHumanCaptchaCompletion(session,config):{verified:false},captchaObservation=await observePendingCaptcha(session.page,config);
    return { ...result,captcha:captchaObservation.pending&&!humanCompletion.verified,captcha_observation:captchaObservation, url:observerUrl(result.url),forms:result.forms.map(f=>({...f,action:observerUrl(f.action)})),fields:result.fields.map(f=>({...f,form_action:f.form_action?observerUrl(f.form_action):null})), buttons:result.buttons.map(b=>({...b,href:b.href?observerUrl(b.href):null,form_action:b.form_action?observerUrl(b.form_action):null})), browser_session_id: session.id, adapter: atsAdapterFor(result.url), current_action: session.current_action, action_history: session.history, uploaded_file_hashes: session.uploads.map(({sha256,filename,evidence,receipt_id})=>({sha256,filename,evidence,...(receipt_id?{receipt_id}:{} )})), fingerprint: hash(JSON.stringify({ url: result.url, fields: result.fields.map(f => [f.name,f.label,f.type,f.required,f.visible,f.disabled,f.readOnly,f.form,f.form_id,f.form_action,f.form_method,f.options?.map(o=>[o.value,o.label])]), forms:result.forms, buttons:result.buttons.map(b=>[b.text,b.type,b.href,b.form_action,b.form_method]),step: result.current_step })), blocked_requests: session.blocked_requests.slice(-10) };
  }
  async function checkpoint(session) {
    const view = await snapshot(session); const state = { application_id: session.application_id, browser_session_id: session.id, current_url: view.url, page_fingerprint: view.fingerprint, current_step: view.current_step, filled_fields: session.filled_fields, uploaded_file_hashes: session.uploads, action_history: session.history, pending_question: session.pending_question, last_safe_checkpoint: new Date().toISOString(), submit_attempted: session.submit_attempted, submission_confirmation: session.submission_confirmation, recovery_attempts: session.recovery_attempts, storage_state: await session.context.storageState() };
    await fs.writeFile(path.join(config.stateRoot, `${session.id}.json`), JSON.stringify(state), { mode: 0o600 }); return { ...view, checkpoint_saved: true };
  }
  async function action(session, operation, payload) {
    session.current_action={operation,selector:payload.selector??null,started_at:new Date().toISOString()};
    if (operation === 'navigate') {session.humanCaptchaViews?.clear();session.humanCaptchaWindow=null;session.humanCaptchaAction=null; await validateDestination(payload.url, config); await session.page.goto(payload.url, { waitUntil: 'domcontentloaded' }); }
    else if (operation === 'dismiss-cookies') {const result=await dismissPracaCookies(session.page);return {...await checkpoint(session),cookie_dismissal:result};}
    else if (operation === 'checkpoint') { session.pending_question = payload.pending_question ?? session.pending_question; return checkpoint(session); }
    else if (operation === 'screenshot') { const name = `${session.id}-${Date.now()}.png`, output = path.join(config.stateRoot, name); await session.page.screenshot({ path: output, fullPage: true }); return { path: output }; }
    else if(operation==='captcha-image')return captureCaptchaImage(session.page);
    else if(operation==='human-captcha-view')return humanCaptchaView(session,config);
    else if(operation==='human-captcha-click')return humanCaptchaClick(session,config,payload);
    else if(operation==='human-captcha-completion')return inspectHumanCaptchaCompletion(session,config);
    else if(operation==='captcha-observation')return observePendingCaptcha(session.page,config);
    else if(operation==='observe-image'){const mask=session.page.frames().map(frame=>frame.locator('input[type=password],input[autocomplete=one-time-code],input[name*=token i],input[name*=otp i],input[name*=totp i],input[name*=authentication_code i]'));const png=await session.page.screenshot({fullPage:false,mask,maskColor:'#18212a'});return {png_base64:png.toString('base64'),captured_at:new Date().toISOString(),persisted:false};}
    else {
      if(['fill','select','check','upload'].includes(operation))await dismissPracaUploadError(session.page);
      const before = await snapshot(session), field = before.fields.find(f => f.selector === payload.selector), button = before.buttons.find(b => b.selector === payload.selector);
      const registerFieldWindow=()=>{if(atsAdapterFor(before.url)==='ashby'&&field?.field_path&&field.form_render_id&&(payload.verified_facts===true||payload.approval==='USER_CONFIRMED')){
        session.ashbyFieldWindows??=new Map();session.ashbyFieldWindows.set(field.field_path,{url:before.url,form_render_id:field.form_render_id,value:operation==='check'?payload.checked!==false:payload.value,label:field.label,type:field.type,role:field.role,expires_at:Date.now()+15000});
      }};
      if (operation === 'submit' && session.submit_attempted) return { ...before, status: session.submission_confirmation ? 'SUBMITTED' : 'SUBMISSION_UNKNOWN', confirmation_id: session.submission_confirmation?.confirmation_id || null };
      if (!field && !button) throw new Error('SELECTOR_NOT_IN_CURRENT_SNAPSHOT');
      const locator = session.page.locator(payload.selector);
      if (operation === 'fill') { if (!field.visible || field.disabled || field.readOnly || ['hidden', 'file', 'checkbox', 'radio', 'submit','password'].includes(field.type)||field.autocomplete==='one-time-code') throw new Error('UNSAFE_FILL'); registerFieldWindow(); await locator.fill(String(payload.value)); session.filled_fields[payload.selector] = String(payload.value); }
      else if (operation === 'select') { if (!field.visible || !field.options) throw new Error('NOT_SELECT'); registerFieldWindow(); await locator.selectOption(payload.value); session.filled_fields[payload.selector] = payload.value; }
      else if(operation==='choose'){if(!field.visible||field.role!=='combobox'||payload.verified_facts!==true)throw Error('VERIFIED_COMBOBOX_REQUIRED');registerFieldWindow();await chooseCombobox(session.page,locator,payload.value);session.filled_fields[payload.selector]=payload.value;}
      else if (operation === 'check') {
        if (!field.visible || !['checkbox', 'radio'].includes(field.type)) throw new Error('NOT_CHECKABLE');
        const consent = classifyConsent(field.label, field.required);
        if (field.type === 'checkbox' && payload.checked !== false) {
          const regularChoice = !field.required && /skills?|fusion|python|cad|fea/i.test(field.label) && !/consent|agree|privacy|marketing/i.test(field.label);
          if (!regularChoice && (consent.consent_type === 'OPTIONAL_SKIP' || consent.consent_type === 'USER_REQUIRED') && payload.approval !== 'USER_CONFIRMED') throw new Error('CONSENT_NEEDS_USER');
          if (consent.consent_type === 'TRUTH_ATTESTATION' && payload.verified_facts !== true && payload.approval !== 'USER_CONFIRMED') throw new Error('TRUTH_ATTESTATION_REQUIRES_VERIFIED_FACTS');
          session.history.push({ ...consent, application_id: session.application_id, timestamp: new Date().toISOString(), user_confirmed: payload.approval === 'USER_CONFIRMED' });
        }
        registerFieldWindow();await setCheckedControl(session.page,locator,payload.checked !== false); session.filled_fields[payload.selector] = payload.checked !== false;
      }
      else if (operation === 'upload') {
        if (field.type !== 'file' || field.disabled) throw new Error('NOT_UPLOAD_FIELD');
        if(!field.visible&&!/\bresume\b|\bcv\b|curriculum|lebenslauf/i.test(field.name+' '+field.label+' '+field.selector))throw new Error('HIDDEN_DOCUMENT_NOT_IDENTIFIED');
        const root = await fs.realpath(config.artifactRoot), target = await fs.realpath(path.resolve(payload.path));
        const relative = path.relative(root, target); if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(target).toLowerCase() !== '.pdf') throw new Error('ARTIFACT_NOT_APPROVED');
        const bytes = await fs.readFile(target); if (bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-' || !payload.sha256 || hash(bytes) !== payload.sha256) throw new Error('ARTIFACT_HASH_OR_FORMAT_INVALID');
        await dismissPracaUploadError(session.page);
        session.uploadWindow={url:before.url,sha256:payload.sha256,filename:path.basename(target),byte_length:bytes.length,bytes,field_path:field.field_path,form_render_id:field.form_render_id,expires_at:Date.now()+30000};
        const upload={selector:payload.selector,sha256:payload.sha256,filename:path.basename(target),evidence:'LOCAL_FILE_SELECTION'};
        const receipt=async response=>{try{
          const request=response.request();
          const requestBody=restoreOmittedMultipartPdf(request.postDataBuffer(),request.headers()['content-type'],session.uploadWindow);
          if(response.ok()&&reviewedAshbyStoragePost({url:request.url(),method:request.method(),body:requestBody,contentType:request.headers()['content-type'],storage:session.uploadWindow?.storage})){upload.evidence='SERVER_STORAGE_RECEIPT';upload.receipt_id='ashby-storage:'+hash(session.uploadWindow.storage.handle);return;}
          if(response.ok()&&reviewedAshbyFileAttach({url:request.url(),body:request.postData(),window:session.uploadWindow,definitions:session.ashbyDefinitions})){const result=await response.json(),form=result.data?.setFormValueToFile;
            const file=form?.sections?.flatMap(s=>s.fieldEntries??[]).find(entry=>entry.fieldValue?.filename===upload.filename)?.fieldValue;
            if(!result.errors&&!form?.errorMessages?.length&&file?.id){upload.evidence='SERVER_UPLOAD_RECEIPT';upload.receipt_id='ashby-file:'+hash(String(file.id));}return;}
          if(!response.ok()||!reviewedUploadRequest({url:request.url(),method:request.method(),body:requestBody,contentType:request.headers()['content-type'],window:session.uploadWindow}))return;
          const result=verifiedUploadReceipt(await response.json(),upload.filename,{url:request.url()});
          if(result){
            upload.evidence='SERVER_UPLOAD_RECEIPT';upload.receipt_id=result.receipt_id;
          }
        }catch{/* No receipt is inferred from an arbitrary successful response. */}};
        session.page.on('response',receipt);const cleanup=setTimeout(()=>session.page.off('response',receipt),30000);cleanup.unref();
        await locator.setInputFiles(target);session.uploads.push(upload);
        if(atsAdapterFor(before.url)==='praca')for(let i=0;i<20&&upload.evidence!=='SERVER_UPLOAD_RECEIPT';i++)await new Promise(resolve=>setTimeout(resolve,250));
      }
      else if (operation === 'click') {
        const safeEntry=button&&safeNavigationButton({adapter:atsAdapterFor(before.url),url:before.url,button,fields:before.fields});
        const cookieChoice=selectedCookieButton(before)?.selector===payload.selector;
        const draftWindow=button?draftNavigationWindow(before,button):null;
        if (field || !button || button.final_submit || !safeEntry&&/submit|send application|apply now|pay|confirm application/i.test(button.text)) throw new Error('USE_GATED_SUBMIT');
        if (button.type === 'submit'&&!draftWindow) throw new Error('USE_GATED_SUBMIT');
        if (!cookieChoice&&!/^(next|continue|back|previous)(\s+step)?$|^(dalej|kontynuuj|wstecz|nastepny krok)$/i.test(button.text.normalize('NFD').replace(/[\u0300-\u036f]/g,''))&&!safeNavigationButton({adapter:atsAdapterFor(before.url),url:before.url,button,fields:before.fields})) throw new Error('UNCLASSIFIED_CLICK_NEEDS_USER');
        if(safeEntry)session.readNavigationUntil=Date.now()+15000;
        if(draftWindow)session.draftWindow=draftWindow;
        await locator.click();
      }
      else if (operation === 'submit') {
        const reason = controlledSubmitPermission(before.url, config);
        if(payload.confirmation_capability){
          if(!config.enabled)throw new Error('PAUSED');
          if(config.denyDomains.includes(new URL(before.url).hostname))throw new Error('DOMAIN_NOT_ALLOWED');
          verifySubmitCapability(payload.confirmation_capability,{secret:config.token,applicationId:session.application_id,snapshot:before});
        }else if(reason) return { ...before, status: 'READY_TO_SUBMIT', dry_run: config.dryRun, submit_blocked_reason: reason };
        if (session.submit_attempted) return { ...before, status: before.confirmation_id ? 'SUBMITTED' : 'SUBMISSION_UNKNOWN' };
        if (!button || (!button.final_submit && !finalSubmitLabel(button.text))) throw new Error('FINAL_BUTTON_REQUIRED');
        if (before.captcha || before.fields.some(f => f.visible && f.required && f.validation_message)) throw new Error('FORM_NOT_READY');
        session.submit_attempted = true; session.history.push({ operation: 'submit_intent', timestamp: new Date().toISOString() }); await checkpoint(session);
        session.submitActive = true;
        let networkConfirmation;
        const responseListener = async response => { try { if (new URL(response.url()).origin === new URL(before.url).origin && response.request().method() === 'POST' && response.ok()) { const result = await response.json(); if (typeof result.confirmation_id === 'string' && result.confirmation_id.length < 200) networkConfirmation = result; } } catch { /* Only structured explicit confirmation counts. */ } };
        session.page.on('response', responseListener);
        try { await locator.click(); await session.page.waitForSelector('[data-confirmation-id]', { timeout: 10000 }); }
        catch { /* Ambiguous outcomes are deliberately never retried. */ }
        finally { session.submitActive = false; session.page.off('response', responseListener); }
        const afterView = await snapshot(session);
        if (networkConfirmation && afterView.confirmation_id === networkConfirmation.confirmation_id) session.submission_confirmation = { confirmation_id: networkConfirmation.confirmation_id, timestamp: new Date().toISOString(), evidence: 'NETWORK_AND_PAGE' };
        const after = await checkpoint(session); return { ...after, status: session.submission_confirmation ? 'SUBMITTED' : 'SUBMISSION_UNKNOWN', confirmation_evidence: session.submission_confirmation?.evidence || null };
      } else throw new Error('UNKNOWN_OPERATION');
    }
    if(['fill','select','check','upload'].includes(operation))session.recovery_attempts=0;
    await session.page.waitForTimeout(350); session.history.push({ operation, selector: payload.selector, timestamp: new Date().toISOString() }); return checkpoint(session);
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      if (req.url === '/health' && req.method === 'GET') return send(200, { ok: true, service: 'browser', sessions: sessions.size });
      if (!authorized(req, config.token)) return send(401, { error: 'UNAUTHORIZED' });
      const url = new URL(req.url, 'http://service'), payload = ['POST', 'PUT'].includes(req.method) ? await bodyJSON(req) : {};
      if(url.pathname==='/sessions'&&req.method==='GET')return send(200,{sessions:[...sessions.values()].map(session=>({browser_session_id:session.id,application_id:session.application_id,adapter:atsAdapterFor(session.page.url()),url:observerUrl(session.page.url())}))});
      if (url.pathname === '/sessions' && req.method === 'POST') { if (typeof payload.application_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(payload.application_id)) throw new Error('INVALID_APPLICATION_ID'); const session = await newSession(payload.application_id,undefined,boardForUrl(payload.url)); if (payload.url) await action(session, 'navigate', payload); return send(201, { session_id: session.id, snapshot: await snapshot(session) }); }
      const [, id, operation] = /^\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname) || [];
      if(id&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))throw new Error('INVALID_SESSION_ID');
      if (operation === 'recover' && req.method === 'POST') {
        if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('INVALID_SESSION_ID');
        const saved = JSON.parse(await fs.readFile(path.join(config.stateRoot, `${id}.json`), 'utf8'));
        if (saved.submission_confirmation) return send(200, { status: 'SUBMITTED', ...saved.submission_confirmation });
        if (saved.submit_attempted) return send(200, { status: 'SUBMISSION_UNKNOWN', reason: 'CHECK_CONFIRMATION_BEFORE_RECOVERY' });
        if (saved.recovery_attempts >= config.maxRecovery) return send(200, { status: 'MANUAL_TAKEOVER', reason: 'RECOVERY_LIMIT' });
        saved.recovery_attempts++; await fs.writeFile(path.join(config.stateRoot, `${id}.json`), JSON.stringify(saved), { mode: 0o600 });
        const fresh = await newSession(saved.application_id, saved); await action(fresh, 'navigate', { url: saved.current_url });
        const view = await snapshot(fresh); return send(200, { session_id: fresh.id, snapshot: view, status: view.captcha ? 'CAPTCHA_WAIT' : /login|two.factor|webauthn/i.test(view.title + view.text) ? 'MANUAL_TAKEOVER' : 'FILLING', replay_required: true, known_fields: saved.filled_fields });
      }
      const session = sessions.get(id); if (!session) return send(404, { error: 'SESSION_NOT_FOUND' });
      if (req.method === 'DELETE') { await checkpoint(session); await session.context.close(); sessions.delete(id); return send(200, { closed: true }); }
      if (req.method === 'GET' && ['snapshot', 'forms', 'form-state'].includes(operation)) return send(200, await snapshot(session));
      if (req.method === 'POST' && operation === 'action-batch') { if (!Array.isArray(payload.actions) || payload.actions.length > 30) throw new Error('INVALID_ACTION_BATCH'); let result; for (const item of payload.actions) { if (!['fill', 'select', 'check', 'upload'].includes(item.operation)) throw new Error('BATCH_REVERSIBLE_ONLY'); result = await action(session, item.operation, item); } return send(200, result || await snapshot(session)); }
      if (req.method === 'POST') return send(200, await action(session, operation, payload));
      send(404, { error: 'NOT_FOUND' });
    } catch (error) { send(400, { error: error.message }); }
  });
  return { server, sessions, config, listen: () => new Promise(resolve => server.listen(config.port, config.host, resolve)), close: async () => { clearInterval(retentionTimer);for (const s of sessions.values()) await s.context.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const service = await createBrowserService(); await service.listen(); console.log(JSON.stringify({ event: 'browser_started', port: service.config.port })); for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); process.exit(0); }); }

