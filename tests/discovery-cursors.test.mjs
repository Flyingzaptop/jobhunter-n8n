import test from 'node:test';import assert from 'node:assert/strict';
import{publishedNextPage,htmlPaginationLinks,listingCursor}from'../services/core/discovery-cursors.mjs';
import{verifyPublicBoardPayload,verifyPublicBoardPosting,runMarketDiscovery}from'../services/core/discovery-v2.mjs';
import{mkdtemp,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import YAML from'yaml';

test('published pagination follows observed next link only, rejecting cross-host, forbidden family and guessed numerals',()=>{
 const html='<a href="/praca_9.html">9</a><a href="https://evil.example/praca_2.html">Następna</a><a href="/api/next">Dalej</a><a href="/praca_2.html">Następna</a>';
 assert.equal(publishedNextPage(htmlPaginationLinks(html),'https://www.praca.pl/praca.html',{pagePattern:'^/praca(?:_[0-9]+)?\\.html$'}),'https://www.praca.pl/praca_2.html');
 assert.equal(publishedNextPage([{href:'/praca/?page=2',text:'2'}],'https://www.olx.pl/praca/'),null);
});
test('listing cursor exhausts durable page snapshot before advancing and records observed cycle end without claiming entire market',()=>{
 const base={rootUrl:'https://board.example/',currentUrl:'https://board.example/?page=2',nextUrl:'https://board.example/?page=3',total:10};
 const partial=listingCursor({...base,offset:0,processed:4});assert.equal(partial.next_listing_offset,4);assert.equal(partial.next_listing_page_url,base.currentUrl);assert.equal(partial.truncated,true);
 const complete=listingCursor({...base,offset:8,processed:2});assert.equal(complete.next_listing_page_url,base.nextUrl);assert.equal(complete.next_listing_offset,0);assert.equal(complete.cycle_completed,false);
 const end=listingCursor({...base,nextUrl:null,offset:8,processed:2});assert.equal(end.cycle_completed,true);assert.equal(end.next_listing_page_url,base.rootUrl);assert.equal(end.coverage_status,'OBSERVED_LISTING_CYCLE_COMPLETE');
});
const source={name:'praca',adapter:'public_listing_html',url:'https://www.praca.pl/praca.html',robots_url:'https://www.praca.pl/robots.txt',allowed_hosts:['www.praca.pl']};
const url='https://www.praca.pl/mechanical-engineer_123.html';
const posting={'@type':'JobPosting',title:'Mechanical Engineer',hiringOrganization:{name:'Employer'},description:'CAD mechanical engineering and prototyping. '.repeat(5),datePosted:'2026-10-01',validThrough:'2026-10-30',jobLocation:{address:{addressLocality:'Wrocław',addressCountry:'PL'}}};
const now=new Date('2026-10-04T12:00:00Z');
test('exact current public board dated detail proves OPEN separately from employer ATS; wrong posting and absent dates stay UNKNOWN',()=>{
 const current=verifyPublicBoardPayload({source,url,postings:[posting],now});assert.equal(current.status,'OPEN');assert.equal(current.method,'CURRENT_PUBLIC_BOARD_POSTING');
 assert.equal(verifyPublicBoardPayload({source,url,postings:[{...posting,url:'https://www.praca.pl/wrong_999.html'}],now}).status,'UNKNOWN');
 assert.equal(verifyPublicBoardPayload({source,url,postings:[{...posting,validThrough:undefined}],now}).status,'UNKNOWN');
 assert.equal(verifyPublicBoardPayload({source,url,postings:[{...posting,validThrough:'2026-10-03'}],now}).status,'CLOSED');
 assert.equal(verifyPublicBoardPayload({source,url,postings:[{...posting,validThrough:'2026-10-04'}],now}).status,'UNKNOWN');
 const anonymous=verifyPublicBoardPayload({source,url,postings:[{...posting,hiringOrganization:'confidential'}],now});
 assert.equal(anonymous.status,'OPEN');assert.equal(anonymous.raw.company_hint,'confidential');
});
test('public board HTTP403 stops detail verification without alternate transport or fake OPEN',async()=>{
 let requests=0;await assert.rejects(()=>verifyPublicBoardPosting({source,url,fetchOptions:{lookupImpl:async()=>[{address:'8.8.8.8',family:4}],sleepImpl:async()=>{},fetchImpl:async()=>{requests++;return new Response('',{status:403});}}}),/SOURCE_HTTP_403/);
 assert.equal(requests,1);
});
test('bounded public-feed cycles persist the published continuation across invocations and restart only after observed end',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'feed-cursor-'));const registryPath=join(dir,'registry.yaml');
 await writeFile(registryPath,YAML.stringify({sources:[{name:'feed',platform:'Arbeitnow',adapter:'arbeitnow',url:'https://board.example/api/jobs',profile:'real',enabled:true,source_class:'global_board',permitted_access:true,allowed_hosts:['board.example'],max_pages:1,min_scan_interval_ms:0}]}));
 let prior;const saved=new Map();const requested=[];
 const repository={pool:{async query(sql,args){if(sql.startsWith('SELECT * FROM market_source_health'))return{rows:prior?[prior]:[]};if(sql.startsWith('INSERT INTO market_source_health'))prior={metadata:args[10],last_success_at:new Date(),status:args[3]};return{rows:[]};}},
  async listCanonicalJobs(){return[...saved.values()];},async insertRaw(){return{raw_id:'raw'};},async upsertCanonicalJob(job){const is_new=!saved.has(job.job_id);saved.set(job.job_id,job);return{job_id:job.job_id,is_new};}};
 const fetchOptions={lookupImpl:async()=>[{address:'8.8.8.8',family:4}],sleepImpl:async()=>{},fetchImpl:async(url)=>{requested.push(url.href);const page=Number(url.searchParams.get('page')??1);return new Response(JSON.stringify({data:[{slug:'job-'+page,title:'Mechanical Engineer '+page,company_name:'Employer',url:'https://board.example/jobs/'+page,description:'CAD prototyping '.repeat(10),location:'Europe'}],links:{next:page===1?'https://board.example/api/jobs?page=2':null}}));}};
 try{
  const first=await runMarketDiscovery({repository,registryPath,fetchOptions});assert.equal(first.sources[0].cycle_completed,false);
  const second=await runMarketDiscovery({repository,registryPath,fetchOptions});assert.equal(second.sources[0].cycle_completed,true);
  await runMarketDiscovery({repository,registryPath,fetchOptions});
  assert.deepEqual(requested,['https://board.example/api/jobs','https://board.example/api/jobs?page=2','https://board.example/api/jobs']);assert.equal(saved.size,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
