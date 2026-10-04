import test from 'node:test';
import assert from 'node:assert/strict';
import {factIndex,sourceFragmentCatalog,compactSchemaForJob} from '../services/core/fit.mjs';
test('supplied candidate location/citizenship have explicit citation IDs with no invented employment or permit provenance',()=>{
 const facts=factIndex({candidate:{base_location:{city:'Wroclaw',country:'Poland'},citizenship:['Poland'],eu_citizen:true,availability:{full_time:true}},onboarding:{legal_name:'Private identity',email:'private@unit.invalid'}});
 const base=facts.get('candidate_base_location');assert.equal(base.provenance,null);assert.equal(base.type,'verified_candidate_metadata');assert.ok(base.statements[0].includes('Wroclaw, Poland'));
 assert.ok(facts.get('candidate_eu_citizenship').statements[0].includes('does not establish'));
 assert.ok(!JSON.stringify([...facts.values()]).includes('private@'));assert.ok(!JSON.stringify([...facts.values()]).includes('Private identity'));
 assert.equal(factIndex({candidate:{base_location:{city:'UNKNOWN',country:'UNKNOWN'}}}).size,0);
});
test('actual bulleted remote-first/no-commute benefit is not scored as a candidate mandatory qualification',()=>{
 const text='- Remote-first with no required commute';const job={title:'Support',description_text:`Requirements\nExperience troubleshooting APIs.\n${text}`};
 const catalog=sourceFragmentCatalog(job),row=catalog.find(f=>f.text===text);assert.equal(row.work_format_only,true);assert.equal(row.importance_hint,null);
 const schema=compactSchemaForJob(job,{projects:[{id:'p',provenance:'PERSONAL_PROJECT',statements:['API work.']}]},catalog);
 assert.ok(!Object.hasOwn(schema.properties.explicit_requirements.properties,String(row.id)));
});
