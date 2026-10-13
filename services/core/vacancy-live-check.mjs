const normalized=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function classifyLiveVacancy(job,view){
 const status=view.http_status,body=normalized(view.text),title=normalized(job.title);
 const blocked=view.captcha||[401,403,429].includes(status)||/just a moment|access denied|verify you are human|checking your browser/.test(normalized(view.title));
 if(blocked)return {status:'UNKNOWN',reason:'ACCESS_OR_HUMAN_CHECK_REQUIRED'};
 if([404,410].includes(status))return {status:'CLOSED',reason:'EXPLICIT_HTTP_GONE'};
 if(status>=500||status==null)return {status:'UNKNOWN',reason:'NETWORK_OR_SERVER_ERROR'};
 if(/(?:job|position|vacancy) (?:is |has been )?(?:no longer available|closed|filled|expired)|no longer accepting applications|oferta (?:jest )?nieaktualna|ogłoszenie wygasło/i.test(view.text??''))return {status:'CLOSED',reason:'EXPLICIT_CLOSED_NOTICE'};
 if(status>=200&&status<300&&title.length>=8&&(normalized(view.title).includes(title)||body.includes(title)))return {status:'OPEN',reason:'VISIBLE_CURRENT_VACANCY_TITLE'};
 return {status:'UNKNOWN',reason:'VACANCY_IDENTITY_NOT_CONFIRMED'};
}
