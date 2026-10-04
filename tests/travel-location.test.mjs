import test from 'node:test';import assert from 'node:assert/strict';
import {deterministicHardReject} from '../services/core/fit.mjs';
test('remote-friendly travel-required location rejects before inference without treating office headquarters as travel',()=>{
 const profile={candidate:{base_location:{city:'Wroclaw',country:'Poland'}}};
 const policy={hard_reject_gate:{enabled:true},work_location_policy:{no_relocation:true,forbid_mandatory_travel:true,required_base:{city:'Wroclaw',country:'Poland'}}};
 const job={title:'Research Engineer',location:'Remote-Friendly (Travel-Required) | San Francisco, CA',work_mode:'REMOTE',description_text:'Research engineering role.'};
 assert.ok(deterministicHardReject({job,profile,policy}).reasons.includes('MANDATORY_TRAVEL_INELIGIBLE'));
 assert.equal(deterministicHardReject({job:{...job,location:'Worldwide',description_text:'Remote worldwide. Our headquarters is San Francisco. No travel required.'},profile,policy}),null);
});
