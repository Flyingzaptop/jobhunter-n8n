import { randomUUID } from 'node:crypto';
import {rememberQuestionAnswer} from './answer-memory.mjs';

export const QUESTION_ANSWER_LIMIT = 2000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export const hitlError = (code, status = 409) => Object.assign(new Error(code), { status, code });
export function boundedAnswer(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > QUESTION_ANSWER_LIMIT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || /^(?:unknown|not known|not sure)$/i.test(value.trim())) throw hitlError('INVALID_USER_ANSWER', 400);
  return value.trim();
}
export function questionEligibility(question, application, profileId) {
  if (question.closed_at) return 'QUESTION_CLOSED';
  if (!application || application.candidate_profile_id !== profileId) return 'QUESTION_NOT_FOR_ACTIVE_PROFILE';
  if (question.answered_at != null || question.answer != null) return 'QUESTION_ALREADY_ANSWERED';
  if (application.status !== 'NEEDS_USER') return 'APPLICATION_NOT_WAITING_FOR_ANSWER';
  const pending = application.last_state?.pending_question;
  if (!pending || pending.request_id !== question.telegram_request_id) return 'QUESTION_CORRELATION_STALE';
  const probe = `${pending.type ?? ''} ${pending.field_type ?? ''} ${pending.field_name ?? ''} ${question.raw_question ?? ''}`;
  if (/captcha|password|passcode|\botp\b|\btotp\b|two.factor|2fa|authentication.code|auth.code|verification.code|one.time.code|\bpin\b|has[lł]o|kod.*(?:weryfik|uwierzyt|jednoraz|logowan)|social.security|passport.number|bank.account|credit.card|\biban\b|secret|api.?key|\btoken\b/i.test(probe)) return 'SECURITY_QUESTION_REQUIRES_MANUAL_TAKEOVER';
  return null;
}
async function event(client, applicationId, kind, payload) {
  await client.query('INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'application', applicationId, kind, payload]);
}
// Caller owns the transaction. Telegram can invoke this inside its durable inbox
// transaction; dashboard and trusted chat tooling invoke the wrapper below.
// Public HTTP callers still use their endpoint's fixed source, never caller input.
export async function acceptQuestionAnswerWithClient(client, { questionId, correlationId, answer, source, profileId }) {
  if (!uuid(questionId) || !uuid(correlationId) || !profileId || !['USER_DASHBOARD','USER_TELEGRAM','USER_CHAT'].includes(source)) throw hitlError('INVALID_QUESTION_ANSWER_REQUEST', 400);
  const value = boundedAnswer(answer);
  const question = (await client.query('SELECT * FROM application_questions WHERE question_id=$1 FOR UPDATE', [questionId])).rows[0];
  if (!question || question.telegram_request_id !== correlationId) throw hitlError('QUESTION_NOT_FOUND', 404);
  const application = (await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE', [question.application_id])).rows[0];
  const denied = questionEligibility(question, application, profileId);
  if (denied) throw hitlError(denied);
  const saved = (await client.query(`UPDATE application_questions SET answer=$2::jsonb,answer_source=$3,confidence=1,reusable=false,answered_at=now()
    WHERE question_id=$1 AND answered_at IS NULL AND answer IS NULL RETURNING question_id,application_id,telegram_request_id`, [questionId, JSON.stringify(value), source])).rows[0];
  if (!saved) throw hitlError('QUESTION_ALREADY_ANSWERED');
  await rememberQuestionAnswer(client,{question,application,answer:value,source});
  await client.query('INSERT INTO application_answer_receipts(question_id,application_id,source) VALUES($1,$2,$3)', [questionId, application.application_id, source]);
  await event(client, application.application_id, 'HITL_ANSWER_ACCEPTED', { question_id: questionId, request_id: correlationId, source });
  return { ...saved, source, dispatch_status: 'PENDING' };
}
export async function answerApplicationQuestion(repository, input) {
  const client = await repository.pool.connect();
  try { await client.query('BEGIN'); const result = await acceptQuestionAnswerWithClient(client, input); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
// Persist correlation before any Telegram send. A failed/missing Telegram
// configuration must not erase the durable question or prevent dashboard answers.
export async function persistPendingApplicationQuestion(repository, { applicationId, rawQuestion, chatId = null }) {
  if (!uuid(applicationId) || typeof rawQuestion !== 'string' || !rawQuestion.trim() || rawQuestion.length > 4096) throw hitlError('INVALID_PENDING_QUESTION', 400);
  const client = await repository.pool.connect();
  try {
    await client.query('BEGIN');
    const app = (await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE', [applicationId])).rows[0];
    if (!app || !['NEEDS_USER','CAPTCHA_WAIT'].includes(app.status) || !app.last_state?.pending_question) throw hitlError('APPLICATION_HAS_NO_PENDING_QUESTION');
    const pending = app.last_state.pending_question;
    if (pending.type !== 'CAPTCHA' && pending.question !== rawQuestion) throw hitlError('PENDING_QUESTION_TEXT_MISMATCH');
    if (pending.request_id) {
      const previous = (await client.query('SELECT * FROM application_questions WHERE application_id=$1 AND telegram_request_id=$2 AND answered_at IS NULL', [applicationId, pending.request_id])).rows[0];
      if (previous) { await client.query('COMMIT'); return previous; }
    }
    const questionId = randomUUID(), requestId = randomUUID();
    const row = (await client.query(`INSERT INTO application_questions(question_id,application_id,normalized_question,raw_question,telegram_request_id,telegram_chat_id)
      VALUES($1,$2,$3,$3,$4,$5) RETURNING *`, [questionId, applicationId, rawQuestion, requestId, chatId || null])).rows[0];
    await client.query("UPDATE applications SET last_state=jsonb_set(last_state,'{pending_question,request_id}',to_jsonb($2::text)),updated_at=now() WHERE application_id=$1", [applicationId, requestId]);
    await event(client, applicationId, 'HITL_QUESTION_PERSISTED', { question_id: questionId, request_id: requestId });
    await client.query('COMMIT'); return row;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function dispatchQuestionAnswer(repository, questionId, dispatch) {
  if (!uuid(questionId) || typeof dispatch !== 'function') throw hitlError('INVALID_ANSWER_DISPATCH', 400);
  const claim = (await repository.pool.query(`UPDATE application_answer_receipts SET dispatch_status='RUNNING',dispatch_started_at=now()
    WHERE question_id=$1 AND dispatch_status='PENDING' RETURNING question_id,application_id,source`, [questionId])).rows[0];
  if (!claim) return { dispatch_status: 'NOT_CLAIMED' };
  try { const result=await dispatch(claim); await repository.pool.query("UPDATE application_answer_receipts SET dispatch_status='COMPLETED',dispatch_completed_at=now() WHERE question_id=$1", [questionId]); return { dispatch_status: 'COMPLETED',result }; }
  catch { await repository.pool.query("UPDATE application_answer_receipts SET dispatch_status='MANUAL_RECONCILIATION',dispatch_completed_at=now(),dispatch_error_code='DISPATCH_FAILED_OR_AMBIGUOUS' WHERE question_id=$1", [questionId]); return { dispatch_status: 'MANUAL_RECONCILIATION' }; }
}
export async function recoverPendingQuestionAnswers(repository, dispatch, {limit=20}={}) {
  if (!Number.isInteger(limit)||limit<1||limit>100||typeof dispatch!=='function') throw hitlError('INVALID_ANSWER_RECOVERY',400);
  const pending=(await repository.pool.query("SELECT question_id FROM application_answer_receipts WHERE dispatch_status='PENDING' ORDER BY created_at LIMIT $1",[limit])).rows;
  const recovered=[];
  for(const row of pending)recovered.push({question_id:row.question_id,...await dispatchQuestionAnswer(repository,row.question_id,dispatch)});
  const attention=(await repository.pool.query("SELECT question_id,application_id,dispatch_status,dispatch_error_code FROM application_answer_receipts WHERE dispatch_status IN ('RUNNING','MANUAL_RECONCILIATION') ORDER BY created_at LIMIT $1",[limit])).rows;
  return {recovered,attention};
}
