import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {needsSourceVerification} from '../services/core/source-validation.mjs';import {workFormatAnalysis,PROMPT_VERSION} from '../services/core/fit.mjs';import {canonicalAnalysisHash} from '../services/core/evidence-hash.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const profile={candidate:{base_location:{city:'Wroclaw',country:'Poland'}}},policy={work_location_policy:{no_relocation:true,required_base:{city:'Wroclaw',country:'Poland',remain_physical:true}}};
function row(){const analysis={prompt_version:PROMPT_VERSION,decision:'REVIEW',overall_fit:70,profile_hash:hash(profile),policy_hash:hash(policy),job_content_hash:'h',requirements:[{}],hard_blockers:[],work_format:{}};return {job_id:'fixture',availability_status:'OPEN',content_hash:'h',work_mode:'UNKNOWN',analysis_json:analysis,cv_manifest:{application_eligible:true,source_verification_required:false,analysis_hash:canonicalAnalysisHash(analysis)}};}
test('unverified location enters the source queue even if a previous CV flag says eligible',()=>{
 const job=row();assert.equal(needsSourceVerification(job,profile,policy),true);
 assert.equal(needsSourceVerification({...job,cv_id:null,cv_manifest:null},profile,policy),true);
 job.analysis_json.hard_blockers=['NO_RELOCATION'];assert.equal(needsSourceVerification(job,profile,policy),false);
});
test('official remote mode plus explicit allowed regions can resolve missing geography without inventing hiring rights',()=>{
 const job={...row(),work_mode:'REMOTE',metadata:{validated_applicant_locations:['Europe']}};
 assert.equal(workFormatAnalysis({job,profile,policy,workFormat:{}}).location_policy_status,'COMPATIBLE');
 assert.equal(workFormatAnalysis({job:{...job,metadata:{}},profile,policy,workFormat:{}}).location_policy_status,'UNVERIFIED');
 assert.notEqual(workFormatAnalysis({job:{...job,metadata:{validated_applicant_locations:['USA']}},profile,policy,workFormat:{}}).location_policy_status,'COMPATIBLE');
 assert.notEqual(workFormatAnalysis({job,profile,policy,workFormat:{work_from_poland_allowed:false}}).location_policy_status,'COMPATIBLE');
 assert.equal(workFormatAnalysis({job,profile,policy,workFormat:{}}).eligible_for_auto_apply,false);
});
