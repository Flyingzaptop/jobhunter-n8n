import {randomUUID} from 'node:crypto';
export async function operatorInbox(repository,{limit=20}={}){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_OPERATOR_INBOX_LIMIT');
 return (await repository.pool.query(`SELECT t.update_id,t.processed_at,t.correlation_json->>'operator_text' text,
  t.correlation_json->>'operator_message_id' message_id,t.correlation_json->>'operator_reply_to' reply_to
  FROM telegram_processed_updates t WHERE t.outcome='ACCEPTED' AND t.correlation_json->>'command'='/operator_message'
  AND NOT EXISTS(SELECT 1 FROM events e WHERE e.event_type='OPERATOR_TELEGRAM_REPLY_SENT' AND e.payload_json->>'update_id'=t.update_id::text)
  ORDER BY t.update_id LIMIT $1`,[limit])).rows;
}
export async function replyToOperator({repository,telegram,updateId,messageId,text}){
 if(!Number.isSafeInteger(Number(messageId))||Number(messageId)<1||typeof text!=='string'||!text.trim()||text.length>4000)throw Error('INVALID_OPERATOR_REPLY');
 const note=(await repository.pool.query("SELECT 1 FROM telegram_processed_updates WHERE update_id=$1 AND outcome='ACCEPTED' AND correlation_json->>'command'='/operator_message' AND correlation_json->>'operator_message_id'=$2 AND correlation_json->>'operator_chat_id'=$3",[updateId,String(messageId),telegram.chatId])).rows[0];
 if(!note)throw Error('OPERATOR_MESSAGE_NOT_FOUND');
 const message=await telegram.call('sendMessage',{text,reply_parameters:{message_id:Number(messageId)}});
 await repository.pool.query("INSERT INTO events(event_id,entity_type,entity_id,event_type,payload_json)VALUES($1,'operator',$2,'OPERATOR_TELEGRAM_REPLY_SENT',$3)",[randomUUID(),telegram.chatId,{update_id:String(updateId),sent_message_id:message.message_id}]);
 return {sent:true,message_id:message.message_id};
}
