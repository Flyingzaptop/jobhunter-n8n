import test from 'node:test';import assert from 'node:assert/strict';import {classifyLiveVacancy} from '../services/core/vacancy-live-check.mjs';
test('blocked and unreachable vacancies are unknown; explicit disappearance is closed',()=>{
 const job={title:'Mechanical Design Engineer'};
 assert.equal(classifyLiveVacancy(job,{http_status:200,text:job.title}).status,'OPEN');
 for(const status of [401,403,429,500,null])assert.equal(classifyLiveVacancy(job,{http_status:status,text:job.title}).status,'UNKNOWN');
 assert.equal(classifyLiveVacancy(job,{http_status:404,captcha:true}).status,'UNKNOWN');
 assert.equal(classifyLiveVacancy(job,{http_status:404}).status,'CLOSED');
 assert.equal(classifyLiveVacancy(job,{http_status:200,text:'Job is no longer available'}).status,'CLOSED');
 assert.equal(classifyLiveVacancy(job,{http_status:200,text:'Careers home'}).status,'UNKNOWN');
});
