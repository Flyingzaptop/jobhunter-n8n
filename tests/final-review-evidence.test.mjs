import test from 'node:test';
import assert from 'node:assert/strict';
import {finalReviewEvidence,employerAutomationPolicy,missingRequiredFields} from '../services/core/application.mjs';
test('mandatory radio groups require a checked option rather than nonempty option values',()=>{
 const fields=[{visible:true,required:true,type:'radio',name:'source',value:'job-board',checked:false},{visible:true,required:true,type:'radio',name:'source',value:'other',checked:false}];
 assert.equal(missingRequiredFields(fields).length,2);
 fields[0].checked=true;assert.equal(missingRequiredFields(fields).length,0);
 assert.equal(missingRequiredFields([...fields,{visible:true,required:true,type:'text',value:'   '}]).length,1);
});
test('actual final review reads supplied form values and verified PDF hash, never missing answers or anti-AI attestations',()=>{
 const profile={onboarding:{legal_name:'Example Candidate',email:'fixture@example.invalid'}},job={title:'Technical internship'},cv={pdf_path:'data/cv-v2/cv.pdf',sha256:'verified-hash',qa_json:{pass:true}};
 const view={title:'Technical internship — employer',text:'Apply now',fields:[{type:'text',visible:true,required:true,value:'Example Candidate'},{type:'email',visible:true,required:true,value:'fixture@example.invalid'}],uploaded_file_hashes:[{sha256:'verified-hash',filename:'cv.pdf',evidence:'SERVER_UPLOAD_RECEIPT'}],captcha:false};
 assert.equal(finalReviewEvidence({view,profile,job,cv}).pass,true);
 assert.equal(finalReviewEvidence({view:{...view,uploaded_file_hashes:[{sha256:'verified-hash',filename:'cv.pdf',evidence:'LOCAL_FILE_SELECTION'}]},profile,job,cv}).pass,false);
 assert.equal(finalReviewEvidence({view,profile,job,cv,outstanding:1}).pass,false);
 assert.equal(finalReviewEvidence({view:{...view,uploaded_file_hashes:[]},profile,job,cv}).pass,false);
 assert.equal(employerAutomationPolicy({...view,text:'The use of AI or other generated content will disqualify my application.'}),'HUMAN_AUTHORED_ONLY');
 assert.equal(finalReviewEvidence({view:{...view,captcha:true},profile,job,cv}).pass,false);
});
