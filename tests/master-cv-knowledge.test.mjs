import test from 'node:test';import assert from 'node:assert/strict';
import {resolveField} from '../services/core/application.mjs';import {standingRecruitmentConsent} from '../services/core/consent-policy.mjs';import {screenRelevance} from '../services/core/relevance-queue.mjs';import {cvSkillRelevance,renderCvV2Html} from '../services/core/cv-v2.mjs';
const profile={onboarding:{date_of_birth:'2004-10-16'},education:[{id:'pwr',provenance:'EDUCATION',institution:'Wroclaw University of Science and Technology',degree:'Bachelor of Engineering',field:'Mechanical Engineering',status:'degree_in_progress',primary_for_forms:true,start_date:'2022-10',semesters_completed:5},{id:'wsb',provenance:'EDUCATION',institution:'WSB Merito',field:'IT Engineering',status:'degree_in_progress'}]};
test('two universities do not cause another school-name question and birth date is a confirmed fact',()=>{
 assert.equal(resolveField({type:'text',label:'School Name'},{profile,job:{}}).value,profile.education[0].institution);
 assert.equal(resolveField({type:'date',label:'Date of birth'},{profile,job:{}}).value,'2004-10-16');
 assert.equal(resolveField({type:'text',label:'Graduation Date'},{profile,job:{}}),null);
});
test('standing consent authorizes recruitment processing but does not invent availability or marketing consent',()=>{
 const policy={consent_policy:{current_recruitment_data_processing:true}};
 assert.equal(standingRecruitmentConsent({type:'checkbox',label:'I consent to processing my personal data for recruitment'},policy),true);
 assert.equal(standingRecruitmentConsent({type:'checkbox',label:'Zgoda na przetwarzanie danych osobowych w rekrutacji'},policy),true);
 assert.equal(standingRecruitmentConsent({type:'checkbox',label:'Marketing and future vacancies data processing'},policy),false);
 assert.equal(standingRecruitmentConsent({type:'checkbox',label:'I will attend Pacific Time coordination hours'},policy),false);
});
test('AutoCAD design is selected as engineering rather than incidental software',()=>{
 const score=screenRelevance({title:'Junior AutoCAD Designer',location:'Wroclaw, Poland',country:'PL',work_mode:'HYBRID',description_text:'Technical drawings and mechanical design',availability_status:'OPEN'});
 assert.equal(score.status,'QUEUED');assert.ok(score.role_hints.includes('mechanical_rd'));assert.equal(cvSkillRelevance('AutoCAD','MECHANICAL'),100);
});
test('education keeps degree in progress and includes both schools and verified semesters',()=>{
 const document={headline:{text:'Engineering student'},summary:[],skills:[],sections:[],application_text:[]};const html=renderCvV2Html(document,profile,'English',{});
 assert.match(html,/WSB Merito/);assert.match(html,/Bachelor of Engineering/);assert.match(html,/Degree in progress/);assert.match(html,/5 semesters completed/);
});
