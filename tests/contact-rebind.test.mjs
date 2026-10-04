import test from 'node:test';
import assert from 'node:assert/strict';
import {profileDigest,reconstructContactOnlyProfile,rebindContactMetadata} from '../scripts/contact-rebind-helper.mjs';
import {canonicalAnalysisHash} from '../services/core/evidence-hash.mjs';
const original={qualifications:['Python'],onboarding:{linkedin_url:'UNKNOWN',legal_name:'Example'}};
const current={...original,onboarding:{...original.onboarding,linkedin_url:'https://www.linkedin.com/in/example-fixture/'}};
test('contact-only update reconstructs the exact prior profile',()=>assert.deepEqual(reconstructContactOnlyProfile(current,profileDigest(original)),original));
test('qualification, identity and extra changes are rejected',()=>{
 for(const changed of [{...current,qualifications:['Python','SQL']},{...current,onboarding:{...current.onboarding,legal_name:'Other'}},{...current,extra:true}])
  assert.throws(()=>reconstructContactOnlyProfile(changed,profileDigest(original)),/beyond/);
});
test('inference provenance retained with explicit metadata audit',()=>{
 const analysis={profile_hash:profileDigest(original),profile_version:'v3',fit_input_hash:'original-input',runtime_statistics:{semantic_attempts:1},requirements:[{match:'YES'}]};
 const manifest={profile_hash:analysis.profile_hash,profile_version:analysis.profile_hash,analysis_hash:canonicalAnalysisHash(analysis),analysis_input_hash:analysis.fit_input_hash,operation_run_id:'real-run',sha256:'pdf-hash'};
 const result=rebindContactMetadata({profile:current,analysis,manifest,at:'now'});
 assert.equal(result.analysis.fit_input_hash,analysis.fit_input_hash);assert.equal(result.analysis.profile_version,'v3');
 assert.deepEqual(result.analysis.runtime_statistics,analysis.runtime_statistics);assert.deepEqual(result.analysis.requirements,analysis.requirements);
 assert.equal(result.manifest.operation_run_id,'real-run');assert.equal(result.manifest.sha256,'pdf-hash');assert.equal(result.audit.inference_performed,false);
 assert.equal(result.manifest.analysis_hash,canonicalAnalysisHash(result.analysis));
});
