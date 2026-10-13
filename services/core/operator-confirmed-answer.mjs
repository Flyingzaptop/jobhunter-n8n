const fold=value=>String(value??'').replace(/[✱*]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
export function operatorConfirmedAnswer(field,application,job){
 const receipt=application?.last_state?.operator_answer_receipts?.find(r=>r.source==='USER_CHAT'&&r.application_id===application.application_id&&r.job_id===job.job_id&&r.profile_id===application.candidate_profile_id&&fold(r.question)===fold(field.label));
 if(!receipt)return null;
 if(receipt.omit===true)return field.required===false?{skip:true,source:'USER_CHAT_EXACT_APPLICATION'}:null;
 let value=receipt.answer;
 if(field.options?.length){const option=field.options.find(o=>fold(o.label)===fold(value));if(!option)return null;value=option.value;}
 return {value,source:'USER_CHAT_EXACT_APPLICATION',receipt_id:receipt.receipt_id};
}
