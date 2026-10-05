import test from 'node:test';import assert from 'node:assert/strict';
import {validateQuestionAnswer} from '../services/core/hitl.mjs';
test('Yes cannot overwrite a city, university, date or a nonbinary degree choice',()=>{
 for(const label of ['Location','School Name','Graduation Date or Anticipated Graduation Date'])assert.throws(()=>validateQuestionAnswer({raw_question:label},{field_type:'text'},'Да'),/INVALID_USER_ANSWER/);
 assert.throws(()=>validateQuestionAnswer({raw_question:'Associate Degree'},{field_type:'radio'},'ДА'),/EXPECTED_OPTION/);
 assert.throws(()=>validateQuestionAnswer({raw_question:'Graduation Date'},{field_type:'text'},'А ты знаешь ответ?'),/EXPECTED_DATE/);
 for(const [label,type,answer] of [['Location','text','Wroclaw, Poland'],['School Name','text','Wroclaw University of Science and Technology'],['Graduation Date','text','2027'],['Consent to recruitment','checkbox','Да'],['Yes - I consent to messages','radio','ДА']])assert.doesNotThrow(()=>validateQuestionAnswer({raw_question:label},{field_type:type},answer));
});
