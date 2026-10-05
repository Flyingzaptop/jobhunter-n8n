import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import YAML from 'yaml';
import {verifyCurrentCvEvidence} from './cv-evidence.mjs';import {reverifyMarketJob} from './discovery-v2.mjs';
import {workFormatAnalysis,PROMPT_VERSION} from './fit.mjs';import {compatibleCvTemplate} from './cv-v2.mjs';import {hitlError} from './hitl.mjs';
export async function assertControlledApplicationReady({repository,applicationId,profile}){
 const app=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1 AND candidate_profile_id=$2',[applicationId,profile.profile_id])).rows[0];
 if(!app||app.status!=='READY_TO_SUBMIT')throw hitlError('APPLICATION_NOT_READY_FOR_CONFIRMED_SUBMIT');
 let job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[app.job_id])).rows[0];
 const open=await reverifyMarketJob({repository,job});if(open.status!=='OPEN')throw hitlError('CURRENT_VACANCY_OPEN_PROOF_REQUIRED');
 job=(await repository.pool.query('SELECT * FROM jobs WHERE job_id=$1',[app.job_id])).rows[0];
 const cv=(await repository.pool.query('SELECT * FROM cv_versions WHERE cv_id=$1',[app.cv_id])).rows[0];
 const analysis=(await repository.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[app.job_id])).rows[0]?.analysis_json;
 const policy=YAML.parse(await readFile('config/search_policy.yaml','utf8'));
 if(!compatibleCvTemplate(cv?.template_version)||!cv.qa_json?.tailoring?.pass||analysis?.prompt_version!==PROMPT_VERSION||Number(analysis.overall_fit)<45||analysis.policy_hash!==createHash('sha256').update(JSON.stringify(policy)).digest('hex')||workFormatAnalysis({job,profile,policy,workFormat:analysis.work_format}).location_policy_status!=='COMPATIBLE'||!(await verifyCurrentCvEvidence({cv,job,analysis,profile})).pass)throw hitlError('CURRENT_APPLICATION_EVIDENCE_REQUIRED');
 return true;
}
