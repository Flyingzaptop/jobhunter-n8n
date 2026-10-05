import test from 'node:test';import assert from 'node:assert/strict';
import {postingOpenEvidence} from '../services/core/application.mjs';
test('Polish vacancy identity and visible Aplikuj prove open; login and unrelated postings remain unknown',()=>{
 const job={title:'Technik utrzymania ruchu',canonical_url:'https://www.praca.pl/technik_123.html'};
 const view={url:job.canonical_url,title:'Oferta pracy: Technik utrzymania ruchu',text:'Technik utrzymania ruchu',buttons:[{text:'Aplikuj',visible:true,disabled:false}]};
 assert.equal(postingOpenEvidence(view,job),'OPEN');
 for(const changed of [{url:'https://www.praca.pl/login'},{title:'Login',text:'Logowanie'},{buttons:[]},{buttons:[{text:'Aplikuj',disabled:true}]},{text:'Oferta jest nieaktualna'}])assert.equal(postingOpenEvidence({...view,...changed},job),changed.text==='Oferta jest nieaktualna'?'CLOSED':'UNKNOWN');
});
