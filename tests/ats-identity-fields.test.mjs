import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveField} from '../services/core/application.mjs';
const profile={onboarding:{legal_name:'Example Candidate',email:'fixture@example.invalid',phone:'+48123456789'}};
test('actual ATS text-based contact labels use supplied facts without assuming marketing or legal answers',()=>{
 for(const [label,type,value] of [['Email*','text',profile.onboarding.email],['Email (required)\n  a1b2c3d4','email',profile.onboarding.email],['Email*Required','email',profile.onboarding.email],['Phone','text',profile.onboarding.phone],['Full name','text',profile.onboarding.legal_name]]){
  assert.equal(resolveField({name:'',label,type},{profile,job:{}}).value,value);
 }
 assert.equal(resolveField({name:'',label:'Email permission for future marketing',type:'text'},{profile,job:{}}),null);
 assert.equal(resolveField({name:'',label:'Are you legally authorized in Canada?',type:'text'},{profile,job:{country:'CA'}}),null);
});
