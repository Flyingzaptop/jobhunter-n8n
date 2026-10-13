import test from 'node:test';import assert from 'node:assert/strict';import {approvedOptionalOmission} from '../services/core/optional-field-omission.mjs';
test('omission receipt is exact to application, job and optional field',()=>{
 const field={selector:'#location',name:'location',label:'Current location',required:false};const app={application_id:'one',last_state:{approved_optional_omissions:{'#location':{source:'USER_CHAT',application_id:'one',job_id:'job',field_name:'location',field_label:'Current location'}}}};
 assert.equal(approvedOptionalOmission(field,app,{job_id:'job'}),true);
 assert.equal(approvedOptionalOmission({...field,required:true},app,{job_id:'job'}),false);
 assert.equal(approvedOptionalOmission(field,app,{job_id:'other'}),false);
 assert.equal(approvedOptionalOmission(field,{...app,application_id:'two'},{job_id:'job'}),false);
});
