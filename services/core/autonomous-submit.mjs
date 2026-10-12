import {runApplication} from './application.mjs';
import {browserConfig} from '../browser-service/server.mjs';
import {Telegram} from './telegram.mjs';
import {createHash} from 'node:crypto';
import {enqueueFormModelReview} from './form-model-review.mjs';
import {autonomousAuthorization,assertAutonomousTarget} from './autonomous-authorization.mjs';
import {prepareApplicationReview,approveApplicationReview} from '../dashboard/review-gates.mjs';
import {assertControlledApplicationReady} from './controlled-submit-gate.mjs';
import {executeConfirmedSubmit} from './confirmed-submit.mjs';

export function autonomousSubmitKey(applicationId,authorizationId){const hex=createHash('sha256').update(`${applicationId}:${authorizationId}`).digest('hex').slice(0,32);return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;}
export async function submitAutonomousApplication({repository,applicationId,profile,browser}){
 const grant=await autonomousAuthorization(profile);
 assertAutonomousTarget(grant,applicationId);
 const app=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1',[applicationId])).rows[0];
 if(app?.status==='READY_TO_SUBMIT'&&!app.last_state?.full_fields_checked){const filled=await runApplication({repository,applicationId,jobId:app.job_id,profile,browser,telegram:new Telegram(),config:{...browserConfig(),dryRun:true,allowRealSubmit:false,fillAllFields:true}});if(filled.status!=='READY_TO_SUBMIT')return filled;}
 const review=await enqueueFormModelReview({repository,applicationId,profile,browser});
 if(review.status!=='APPROVED')return {blocked_reason:'MODEL_FORM_REVIEW_PENDING'};
 await assertControlledApplicationReady({repository,applicationId,profile});
 const packet=await prepareApplicationReview(repository,applicationId,profile,browser,{campaignId:`AUTONOMOUS_${grant.authorization_id}`});
 await approveApplicationReview(repository,applicationId,packet.gate.approval_id,packet.gate.binding_digest,profile,browser,{source:'USER_AUTONOMOUS'});
 await repository.event('application',applicationId,'AUTONOMOUS_SUBMIT_AUTHORIZED',{authorization_id:grant.authorization_id,source:grant.source,binding_digest:packet.gate.binding_digest});
 return executeConfirmedSubmit({repository,applicationId,approvalId:packet.gate.approval_id,bindingDigest:packet.gate.binding_digest,idempotencyKey:autonomousSubmitKey(applicationId,grant.authorization_id+':'+packet.gate.approval_id),profile,browser,confirmationSource:'USER_AUTONOMOUS'});
}
