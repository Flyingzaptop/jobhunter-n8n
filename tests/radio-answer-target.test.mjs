import test from 'node:test';import assert from 'node:assert/strict';
import {radioAnswerTarget,resolveField} from '../services/core/application.mjs';
test('radio answers select an exact degree, and No never confirms the Yes option',()=>{
 const field={type:'radio',name:'degree',form:null,visible:true,label:'Associate Degree',value:'associate'},bachelor={...field,label:'Bachelor Degree',value:'bachelor'};
 assert.equal(radioAnswerTarget(field,[field,bachelor],'Bachelor Degree'),bachelor);assert.equal(radioAnswerTarget(field,[field,bachelor],'yes'),null);
 const yes={...field,name:'sms',label:'Yes - I consent',value:'given'},no={...yes,label:'No - I do not consent',value:'notGiven'};
 assert.equal(radioAnswerTarget(yes,[yes,no],'Нет'),no);
});
test('city, state, and country label reuses the confirmed home city',()=>{assert.equal(resolveField({type:'text',role:'combobox',label:'Location',description:'City, State, and Country'},{profile:{candidate:{base_location:{city:'Wroclaw',country:'Poland'}}},job:{}}).value,'Wroclaw, Poland');});
