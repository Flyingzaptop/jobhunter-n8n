import test from 'node:test';import assert from 'node:assert/strict';import {onboarding} from '../services/dashboard/queries.mjs';
const profile={profile_version:'fixture',candidate:{base_location:{city:'Wroclaw',country:'Poland'}},onboarding:{legal_name:'Maria Kowalska',email:'maria@private.invalid',phone:'+48123456789',date_of_birth:'UNKNOWN',github_url:'UNKNOWN',portfolio_url:'UNKNOWN',notice_period:'UNKNOWN',relocation_willing:'UNKNOWN',b2b_willing:'UNKNOWN'},education:[{graduation_date:'UNKNOWN'}]};
const policy={work_location_policy:{no_relocation:true,required_base:{city:'Wroclaw',country:'Poland',remain_physical:true}},compensation_filter:{enabled:false,minimum:null}};
test('known startup identity/base are ready despite optional unknown ATS fields',async()=>{
 const result=await onboarding(profile,policy);assert.equal(result.startup_ready,true);assert.equal(result.blocking_missing_count,0);assert.deepEqual(result.missing_fields,[]);
 assert.ok(result.optional_unknown_fields.includes('onboarding.date_of_birth'));assert.ok(result.optional_unknown_fields.includes('education.0.graduation_date'));
 assert.ok(!result.optional_unknown_fields.includes('onboarding.relocation_willing'));assert.equal(result.identity_summary.first_name,'Maria');
});
test('missing or malformed actual required identity remains a blocker',async()=>{
 const result=await onboarding({...profile,onboarding:{...profile.onboarding,email:'UNKNOWN',phone:'12'}},policy);
 assert.equal(result.startup_ready,false);assert.deepEqual(result.blocking_missing_fields,['onboarding.email','onboarding.phone']);
});
test('authoritative user policy resolves effective preferences without mutating private facts',async()=>{
 const before=JSON.stringify(profile),result=await onboarding(profile,policy);
 assert.equal(result.effective_preferences.relocation_willing.value,false);assert.equal(result.effective_preferences.relocation_willing.provenance,'USER_POLICY');
 assert.equal(result.effective_preferences.compensation_filter_enabled.value,false);assert.equal(JSON.stringify(profile),before);
});
