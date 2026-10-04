import { randomUUID } from "node:crypto";
import {acceptQuestionAnswerWithClient} from './hitl.mjs';
import {acceptCaptchaTelegramReply,acceptCaptchaTransportReply} from './captcha-telegram.mjs';
const updateId = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Telegram update ID');
  return value;
};
const rejectionCodes = new Map([
  ['Invalid outcome', 'INVALID_OUTCOME'], ['Invalid application ID', 'INVALID_APPLICATION_ID'],
  ['Unknown application', 'UNKNOWN_APPLICATION'], ['Reply to the pending question required', 'REPLY_REQUIRED'],
  ['Unknown or already answered question', 'UNKNOWN_OR_ANSWERED_QUESTION'], ['Invalid Telegram message', 'INVALID_MESSAGE'],
]);
const needsDispatch = accepted => Boolean(accepted.application_id || accepted.command);
const correlation = accepted => Object.fromEntries(['application_id','question_id','command','outcome','captcha_handoff_id','verify_requested','transport_request_id','transport_valid']
  .filter(key => accepted[key] !== undefined).map(key => [key, accepted[key]]));

export async function getTelegramPollingCursor(repo) {
  const row = (await repo.pool.query('SELECT next_update_id FROM telegram_update_cursor WHERE id=true')).rows[0];
  if (!row) throw new Error('Telegram cursor migration missing');
  return updateId(Number(row.next_update_id));
}
export async function acknowledgeIgnoredTelegramUpdate(repo, id) {
  updateId(id);
  const client = await repo.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM telegram_update_cursor WHERE id=true FOR UPDATE');
    await client.query("INSERT INTO telegram_processed_updates(update_id,outcome) VALUES($1,'IGNORED_UNAUTHORIZED_CHAT') ON CONFLICT DO NOTHING", [id]);
    await client.query('UPDATE telegram_update_cursor SET next_update_id=GREATEST(next_update_id,$1),updated_at=now() WHERE id=true', [id + 1]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export class Telegram {
  constructor({
    token = process.env.TELEGRAM_BOT_TOKEN,
    chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID,
    fetchImpl = fetch,
  } = {}) {
    this.token = token;
    this.chatId = String(chatId ?? "");
    this.fetch = fetchImpl;
  }
  async call(method, payload) {
    if (!this.token || !this.chatId) throw new Error("Telegram not configured");
    const response = await this.fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, chat_id: this.chatId }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw new Error("Telegram API rejected request");
    return result.result;
  }
  async send(text) {
    return this.call("sendMessage", { text });
  }
  async request(repo, applicationId, text) {
    const previous=(await repo.pool.query(`SELECT q.* FROM application_questions q JOIN applications a USING(application_id) WHERE q.application_id=$1 AND q.raw_question=$2 AND q.answered_at IS NULL AND q.telegram_request_id::text=a.last_state->'pending_question'->>'request_id'`,[applicationId,text])).rows[0];
    let requestId=previous?.telegram_request_id??randomUUID(),questionId=previous?.question_id??randomUUID();
    if(previous?.telegram_message_id)return requestId;
    if(!previous)await repo.pool.query(`WITH persisted AS (INSERT INTO application_questions(question_id,application_id,normalized_question,raw_question,telegram_request_id,telegram_chat_id) VALUES($1,$2,$3,$3,$4,$5) RETURNING telegram_request_id) UPDATE applications SET last_state=last_state || jsonb_build_object('pending_question',COALESCE(last_state->'pending_question','{}'::jsonb)||jsonb_build_object('request_id',(SELECT telegram_request_id::text FROM persisted))) WHERE application_id=$2`,[questionId,applicationId,text,requestId,this.chatId]);
    let message;
    try{message = await this.send(
      `Need your answer\nApplication: ${applicationId}\nRequest: ${requestId}\n\n${text}\nReply to this message.`,
    );}catch(error){
      await repo.event('application',applicationId,'HITL_NOTIFICATION_FAILED',{question_id:questionId,request_id:requestId,reason:this.token&&this.chatId?'DELIVERY_FAILED':'TELEGRAM_NOT_CONFIGURED'});
      return requestId;
    }
    await repo.pool.query(
      "UPDATE application_questions SET telegram_message_id=$2 WHERE question_id=$1",
      [questionId, message.message_id],
    );
    return requestId;
  }
  async accept(repo, update) {
    const message = update.message;
    if (!message || String(message.chat?.id) !== this.chatId)
      throw new Error("Unauthorized Telegram chat");
    const text = message.text ?? "";
    if (typeof text !== 'string' || text.length > 4096) throw new Error('Invalid Telegram message');
    if (text === "/pause" || text === "/resume") {
      await repo.pool.query(
        "UPDATE runtime_control SET paused=$1,updated_at=now() WHERE id=true",
        [text === "/pause"],
      );
      return { command: text };
    }
    if (["/summary", "/weekly", "/status", "/captcha_queue", "/start"].includes(text)) return { command: text };
    if (text.startsWith("/outcome ")) {
      const [, id, status] = text.split(/\s+/);
      const allowed = [
        "RECRUITER_REPLY",
        "HR_SCREEN",
        "TECHNICAL_INTERVIEW",
        "INTERVIEW_OTHER",
        "OFFER",
        "REJECTED",
        "WITHDRAWN",
        "NO_RESPONSE",
      ];
      if (!allowed.includes(status)) throw new Error("Invalid outcome");
      if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id ?? '')) throw new Error('Invalid application ID');
      if (!(await repo.pool.query('SELECT application_id FROM applications WHERE application_id=$1', [id])).rows.length) throw new Error('Unknown application');
      await repo.pool.query(
        `INSERT INTO application_outcomes(outcome_id,application_id,outcome_status,source) VALUES($1,$2,$3,'USER_TELEGRAM')`,
        [randomUUID(), id, status],
      );
      return { outcome: status };
    }
    if (!message.reply_to_message?.message_id || !text.trim())
      throw new Error("Reply to the pending question required");
    if(!Number.isSafeInteger(message.reply_to_message.message_id)||message.reply_to_message.message_id<1)throw new Error('Invalid Telegram message');
    const captcha=await acceptCaptchaTelegramReply(repo,{messageId:message.reply_to_message.message_id,chatId:this.chatId,text});
    if(captcha)return captcha;
    const transport=await acceptCaptchaTransportReply(repo,{messageId:message.reply_to_message.message_id,chatId:this.chatId,text});
    if(transport)return transport;
    const { rows } = await repo.pool.query(
      `SELECT q.*,a.candidate_profile_id FROM application_questions q JOIN applications a USING(application_id) WHERE q.telegram_message_id=$1 AND q.telegram_chat_id=$2 AND q.answered_at IS NULL`,
      [message.reply_to_message.message_id,this.chatId],
    );
    if (rows.length !== 1)
      throw new Error("Unknown or already answered question");
    const saved=await acceptQuestionAnswerWithClient(repo.pool,{questionId:rows[0].question_id,correlationId:rows[0].telegram_request_id,answer:text,source:'USER_TELEGRAM',profileId:rows[0].candidate_profile_id});
    await repo.event(
      "application",
      rows[0].application_id,
      "TELEGRAM_ANSWERED",
      { question_id: rows[0].question_id },
    );
    return saved;
  }
  async acceptDurably(repo, update) {
    const id = updateId(update?.update_id);
    if (!update.message || String(update.message.chat?.id) !== this.chatId) throw new Error('Unauthorized Telegram chat');
    const client = await repo.pool.connect();
    try {
      await client.query('BEGIN');
      // One ordered inbound acceptance at a time, including duplicate requests.
      await client.query('SELECT id FROM telegram_update_cursor WHERE id=true FOR UPDATE');
      const previous = (await client.query('SELECT * FROM telegram_processed_updates WHERE update_id=$1', [id])).rows[0];
      if (previous) {
        await client.query('COMMIT');
        return { update_id: id, durable: true, duplicate: true, outcome: previous.outcome, dispatch_status: previous.dispatch_status };
      }
      const transactional = { pool: client, event: async (type, entity, event, payload) => client.query(
        'INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), type, entity, event, { ...payload, telegram_update_id: id }]) };
      let accepted; let outcome = 'ACCEPTED'; let errorCode = null;
      try { accepted = await this.accept(transactional, update); }
      catch (error) {
        errorCode = rejectionCodes.get(error.message)??(error.code&&/^(?:INVALID_USER_ANSWER|QUESTION_|APPLICATION_NOT_WAITING|SECURITY_QUESTION|CAPTCHA_REPLY_|CAPTCHA_TRANSPORT_)/.test(error.code)?error.code:null);
        if (!errorCode) throw error;
        accepted = {}; outcome = 'REJECTED';
      }
      const dispatchStatus = needsDispatch(accepted) ? 'PENDING' : 'NOT_REQUIRED';
      await client.query(`INSERT INTO telegram_processed_updates(update_id,outcome,correlation_json,dispatch_status,dispatch_error_code)
        VALUES($1,$2,$3,$4,$5)`, [id, outcome, correlation(accepted), dispatchStatus, errorCode]);
      await client.query('UPDATE telegram_update_cursor SET next_update_id=GREATEST(next_update_id,$1),updated_at=now() WHERE id=true', [id + 1]);
      await client.query('COMMIT');
      return { update_id: id, durable: true, duplicate: false, outcome, dispatch_status: dispatchStatus,
        ...(errorCode ? { error_code: errorCode } : {}), accepted: correlation(accepted) };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async dispatchAccepted(repo, id, dispatch) {
    updateId(id);
    const claim = (await repo.pool.query(`UPDATE telegram_processed_updates SET dispatch_status='RUNNING',dispatch_started_at=now()
      WHERE update_id=$1 AND dispatch_status='PENDING' RETURNING correlation_json`, [id])).rows[0];
    if (!claim) {
      const row = (await repo.pool.query('SELECT dispatch_status,dispatch_error_code FROM telegram_processed_updates WHERE update_id=$1', [id])).rows[0];
      return { dispatch_status: row?.dispatch_status ?? 'NOT_REQUIRED', ...(row?.dispatch_error_code ? { error_code: row.dispatch_error_code } : {}) };
    }
    try {
      const result = await dispatch(claim.correlation_json);
      await repo.pool.query("UPDATE telegram_processed_updates SET dispatch_status='COMPLETED',dispatch_completed_at=now() WHERE update_id=$1", [id]);
      return { dispatch_status: 'COMPLETED', result };
    } catch (error) {
      // Browser/Telegram external actions have no distributed transaction. A
      // started dispatch is never blindly retried after a crash or exception.
      await repo.pool.query(`UPDATE telegram_processed_updates SET dispatch_status='MANUAL_RECONCILIATION',dispatch_completed_at=now(),dispatch_error_code='DISPATCH_FAILED_OR_AMBIGUOUS' WHERE update_id=$1`, [id]);
      return { dispatch_status: 'MANUAL_RECONCILIATION', error_code: 'DISPATCH_FAILED_OR_AMBIGUOUS' };
    }
  }
  async processUpdate(repo, update, dispatch) {
    const receipt = await this.acceptDurably(repo, update);
    const delivered = receipt.outcome === 'ACCEPTED' ? await this.dispatchAccepted(repo, receipt.update_id, dispatch) : {};
    return { ...receipt, ...delivered };
  }
  async recoverPending(repo, dispatch, { limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid Telegram recovery limit');
    const pending = (await repo.pool.query("SELECT update_id FROM telegram_processed_updates WHERE dispatch_status='PENDING' ORDER BY update_id LIMIT $1", [limit])).rows;
    const recovered = [];
    for (const row of pending) recovered.push({ update_id: Number(row.update_id), ...await this.dispatchAccepted(repo, Number(row.update_id), dispatch) });
    // A RUNNING row may belong to a live worker. Show it for reconciliation;
    // never steal/retry an external dispatch using a guessed timeout.
    const attention = (await repo.pool.query("SELECT update_id,dispatch_status FROM telegram_processed_updates WHERE dispatch_status IN('RUNNING','MANUAL_RECONCILIATION') ORDER BY update_id LIMIT $1", [limit])).rows;
    return { recovered, attention };
  }
}
