import {reverifyMarketJob} from './discovery-v2.mjs';
import {hitlError} from './hitl.mjs';
export async function refreshReadyReview({repository,applicationId,profile}){
 const row=(await repository.pool.query('SELECT j.* FROM applications a JOIN jobs j USING(job_id) WHERE a.application_id=$1 AND a.candidate_profile_id=$2',[applicationId,profile.profile_id])).rows[0];
 if(!row)throw hitlError('APPLICATION_NOT_FOR_ACTIVE_PROFILE',404);
 const url=new URL(row.canonical_url);
 if(row.metadata?.test_fixture===true||/(?:^|\.)(?:invalid|example\.com)$/.test(url.hostname))return;
 const result=await reverifyMarketJob({repository,job:{...row.metadata,...row}});
 if(result.status!=='OPEN')throw hitlError(result.status==='CLOSED'?'VACANCY_CLOSED':'VACANCY_REVERIFICATION_REQUIRED');
 if(result.job?.content_hash&&result.job.content_hash!==row.content_hash)throw hitlError('VACANCY_CHANGED_REEVALUATION_REQUIRED');
}
