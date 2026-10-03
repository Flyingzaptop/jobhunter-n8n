import { randomUUID } from "node:crypto";
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
    const requestId = randomUUID(),
      questionId = randomUUID();
    await repo.pool.query(
      `INSERT INTO application_questions(question_id,application_id,normalized_question,raw_question,telegram_request_id) VALUES($1,$2,$3,$3,$4)`,
      [questionId, applicationId, text, requestId],
    );
    const message = await this.send(
      `Need your answer\nApplication: ${applicationId}\nRequest: ${requestId}\n\n${text}\nReply to this message.`,
    );
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
    if (text === "/pause" || text === "/resume") {
      await repo.pool.query(
        "UPDATE runtime_control SET paused=$1,updated_at=now() WHERE id=true",
        [text === "/pause"],
      );
      return { command: text };
    }
    if (["/summary", "/status"].includes(text)) return { command: text };
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
      await repo.pool.query(
        `INSERT INTO application_outcomes(outcome_id,application_id,outcome_status,source) VALUES($1,$2,$3,'USER_TELEGRAM')`,
        [randomUUID(), id, status],
      );
      return { outcome: status };
    }
    if (!message.reply_to_message?.message_id || !text.trim())
      throw new Error("Reply to the pending question required");
    const { rows } = await repo.pool.query(
      `UPDATE application_questions SET answer=$1,answer_source='USER_TELEGRAM',confidence=1,answered_at=now() WHERE telegram_message_id=$2 AND answered_at IS NULL RETURNING application_id,question_id,raw_question`,
      [JSON.stringify(text), message.reply_to_message.message_id],
    );
    if (rows.length !== 1)
      throw new Error("Unknown or already answered question");
    await repo.event(
      "application",
      rows[0].application_id,
      "TELEGRAM_ANSWERED",
      { question_id: rows[0].question_id },
    );
    return rows[0];
  }
}
