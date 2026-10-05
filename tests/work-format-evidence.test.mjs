import test from 'node:test';import assert from 'node:assert/strict';
import {enrichPostingWorkMode,explicitWorkMode,declaredWorkMode} from '../services/core/work-format-evidence.mjs';
import {deterministicHardReject,workFormatAnalysis} from '../services/core/fit.mjs';
const policy={work_location_policy:{exclude_onsite:true,no_relocation:true,required_base:{city:'Wroclaw',country:'Poland'}}};
test('Praca format comes from the actual offer badge, never a navigation remote keyword',()=>{
 const html='<nav>praca zdalna</nav><div class="app-offer__header-item app-offer__header-item--home" title="Tryb pracy"><span title="praca stacjonarna">praca stacjonarna</span></div>';
 const p=enrichPostingWorkMode({title:'Engineer',description:'Real qualifications.'},{html,url:'https://www.praca.pl/engineer_1.html'});
 assert.equal(p.work_mode,'ONSITE');assert.equal(p.work_format_evidence.quote,'praca stacjonarna');assert.ok(p.description.includes('Work format: praca stacjonarna'));
 assert.equal(enrichPostingWorkMode({description:'Real'}, {html:'<nav>praca zdalna</nav>',url:'https://www.praca.pl/engineer_1.html'}).work_mode,undefined);
});
test('hybrid is not accidentally downgraded to remote and unknown work format stays unknown',()=>{
 assert.equal(declaredWorkMode('hybrid / remote'),'HYBRID');assert.equal(explicitWorkMode({description_text:'Work format: praca hybrydowa'}).mode,'HYBRID');
 assert.equal(explicitWorkMode({title:'Engineer',location:'Wroclaw',description_text:'Engineering skills required.'}).mode,'UNKNOWN');
 assert.equal(explicitWorkMode({description_text:'This role is not on-site.'}).mode,'UNKNOWN');
});
test('onsite is rejected even in Wroclaw before model inference; nearby hybrid remains eligible',()=>{
 const profile={candidate:{base_location:{city:'Wroclaw',country:'Poland'}}},base={title:'Engineer',location:'Wroclaw, Poland',country:'PL',description_text:'Real role.',canonical_url:'https://www.praca.pl/test_1.html'};
 assert.ok(deterministicHardReject({job:{...base,work_mode:'ONSITE'},profile,policy}).reasons.includes('ONSITE_WORK_EXCLUDED'));
 assert.ok(deterministicHardReject({job:{...base,work_mode:'UNKNOWN',description_text:'Work format: praca stacjonarna'},profile,policy}).reasons.includes('ONSITE_WORK_EXCLUDED'));
 assert.equal(deterministicHardReject({job:{...base,work_mode:'HYBRID'},profile,policy}),null);
 assert.equal(workFormatAnalysis({job:base,profile,policy,workFormat:{remote_allowed:false,hybrid_required:false,office_location:'Wroclaw',office_country:'Poland'}}).location_policy_status,'INCOMPATIBLE');
});
