import test from 'node:test';import assert from 'node:assert/strict';import {matchOfficialRoute} from '../services/core/employer-route.mjs';
test('Lever route binds an exact employer and posting, rejects cross-board and ambiguous links',()=>{
 const job={company:'TSMG',title:'Polish validator'},source={company:'TSMG',board:'tsmg',adapter:'lever',permitted_access:true,name:'lever-tsmg'};
 const posting={id:'abc',text:job.title,applyUrl:'https://jobs.lever.co/tsmg/abc/apply'};
 assert.ok(matchOfficialRoute(job,source,[posting]));
 assert.equal(matchOfficialRoute(job,source,[posting,posting]),null);
 assert.equal(matchOfficialRoute(job,source,[{...posting,applyUrl:'https://jobs.lever.co/other/abc/apply'}]),null);
 assert.equal(matchOfficialRoute({...job,company:'Other'},source,[posting]),null);
});
test('official employer route requires configured company, exact title, unique posting and trusted board URL',()=>{
 const job={company:'Canonical',title:'Python Engineer'},source={company:'Canonical',adapter:'greenhouse',permitted_access:true,name:'canonical',board:'canonical'},posting={id:1,title:'Python Engineer',absolute_url:'https://job-boards.greenhouse.io/canonical/jobs/1'};
 assert.ok(matchOfficialRoute(job,source,[posting]));assert.equal(matchOfficialRoute({...job,company:'Other'},source,[posting]),null);assert.equal(matchOfficialRoute(job,source,[posting,posting]),null);assert.equal(matchOfficialRoute(job,source,[{...posting,absolute_url:'https://evil.example/canonical/jobs/1'}]),null);assert.equal(matchOfficialRoute({...job,title:'Senior Python Engineer'},source,[posting]),null);
});
