import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const ASHBY_PUBLIC_QUERIES=JSON.parse(readFileSync(new URL('../../config/ats_public_read_queries.json',import.meta.url),'utf8')).queries;
export function atsAdapterFor(value){let host;try{host=new URL(value).hostname.toLowerCase();}catch{return 'generic';}for(const [id,domains] of Object.entries({greenhouse:['greenhouse.io'],lever:['lever.co'],ashby:['ashbyhq.com'],smartrecruiters:['smartrecruiters.com'],teamtailor:['teamtailor.com'],workday:['myworkdayjobs.com'],erecruiter:['erecruiter.pl'],praca:['praca.pl'],pracuj:['pracuj.pl'],olx:['olx.pl'],linkedin:['linkedin.com']}))if(domains.some(d=>host===d||host.endsWith('.'+d)))return id;return 'generic';}
export function finalSubmitLabel(text){
 const label=String(text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().trim();
 return /^(?:submit(?: your)? application|send application|submit|wyslij(?: aplikacje| zgloszenie)?)$/.test(label);
}
export function reviewedReadPost({url,body,adapter}){
 const target=new URL(url);if(atsAdapterFor(url)!==adapter)return {allowed:false,reason:'ADAPTER_ORIGIN_MISMATCH'};
 let data;try{data=JSON.parse(body??'');}catch{return {allowed:false,reason:'UNREVIEWED_PAYLOAD'};}
 if(adapter==='workday'&&/^\/wday\/cxs\/[^/]+\/[^/]+\/jobs$/.test(target.pathname)){
  if(Object.keys(data).some(k=>!['appliedFacets','limit','offset','searchText'].includes(k)))return {allowed:false,reason:'WORKDAY_SEARCH_PAYLOAD_REJECTED'};
  if(!Number.isInteger(data.limit)||data.limit<1||data.limit>100||!Number.isInteger(data.offset)||data.offset<0||typeof data.searchText!=='string'||data.searchText.length>500||!data.appliedFacets||typeof data.appliedFacets!=='object'||Array.isArray(data.appliedFacets))return {allowed:false,reason:'WORKDAY_SEARCH_PAYLOAD_REJECTED'};
  return {allowed:true,operation:'PUBLIC_VACANCY_SEARCH',reversible:true,submitting:false};
 }
 if(adapter==='ashby'&&target.hostname==='jobs.ashbyhq.com'&&target.pathname==='/api/non-user-graphql'){
  if(Object.keys(data).some(k=>!['operationName','variables','query'].includes(k))||target.searchParams.get('op')!==data.operationName||[...target.searchParams.keys()].some(k=>k!=='op'))return {allowed:false,reason:'ASHBY_PUBLIC_QUERY_PAYLOAD_REJECTED'};
  const query=ASHBY_PUBLIC_QUERIES.find(q=>q.operation_name===data.operationName);
  if(!query||typeof data.query!=='string'||createHash('sha256').update(data.query).digest('hex')!==query.query_sha256||!data.variables||typeof data.variables!=='object'||Array.isArray(data.variables))return {allowed:false,reason:'ASHBY_QUERY_NOT_REVIEWED'};
  const v=data.variables;
  if(typeof v.organizationHostedJobsPageName!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v.organizationHostedJobsPageName))return {allowed:false,reason:'ASHBY_BOARD_ID_REJECTED'};
  const valid=data.operationName==='ApiJobPosting'?Object.keys(v).every(k=>['organizationHostedJobsPageName','jobPostingId'].includes(k))&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.jobPostingId):Object.keys(v).every(k=>['organizationHostedJobsPageName','searchContext'].includes(k))&&(v.searchContext===undefined||v.searchContext==='JobPosting');
  if(!valid)return {allowed:false,reason:'ASHBY_PUBLIC_QUERY_VARIABLES_REJECTED'};
  return {allowed:true,operation:'PUBLIC_VACANCY_FORM_SCHEMA_READ',reversible:true,submitting:false};
 }
 return {allowed:false,reason:'NO_REVIEWED_READ_POST'};
}
export function safeNavigationButton({adapter,url,button,fields}){
 if(['praca','pracuj','olx','linkedin'].includes(adapter)&&!fields.some(f=>f.type==='file')&&button.visible!==false&&!button.disabled&&button.type!=='submit'&&!button.final_submit){
  const text=String(button.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if(/^(?:aplikuj(?: teraz| szybko)?|apply(?: now| on company website)?|easy apply|latwe aplikowanie)$/.test(text)){
   if(!button.href)return adapter==='linkedin'&&/easy apply|latwe aplikowanie/.test(text);
   try{const target=new URL(button.href,url);return target.protocol==='https:'&&!target.username&&!target.password&&atsAdapterFor(target.href)!=='generic';}catch{return false;}
  }
 }
 if(adapter==='generic'||fields.some(f=>f.visible&&f.required)||button.type==='submit'||button.final_submit)return false;
 if(!/^apply(?: for (?:this|the) (?:job|position))?$/i.test(button.text??'')||!button.href)return false;
 const from=new URL(url),to=new URL(button.href,from);
 return ['http:','https:'].includes(to.protocol)&&from.origin===to.origin&&atsAdapterFor(to.href)===adapter&&/\/(?:apply|application)(?:\/|$)/.test(to.pathname);
}
export function observerUrl(value){try{const url=new URL(value);for(const key of [...url.searchParams.keys()])if(/token|password|code|signature|credential|auth|key/i.test(key))url.searchParams.set(key,'[redacted]');url.username='';url.password='';return url.href;}catch{return '';}}
