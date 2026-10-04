export function atsAdapterFor(value){let host;try{host=new URL(value).hostname.toLowerCase();}catch{return 'generic';}for(const [id,domains] of Object.entries({greenhouse:['greenhouse.io'],lever:['lever.co'],ashby:['ashbyhq.com'],smartrecruiters:['smartrecruiters.com'],teamtailor:['teamtailor.com'],workday:['myworkdayjobs.com']}))if(domains.some(d=>host===d||host.endsWith('.'+d)))return id;return 'generic';}
export function reviewedReadPost({url,body,adapter}){
 const target=new URL(url);if(atsAdapterFor(url)!==adapter)return {allowed:false,reason:'ADAPTER_ORIGIN_MISMATCH'};
 let data;try{data=JSON.parse(body??'');}catch{return {allowed:false,reason:'UNREVIEWED_PAYLOAD'};}
 if(adapter==='workday'&&/^\/wday\/cxs\/[^/]+\/[^/]+\/jobs$/.test(target.pathname)){
  if(Object.keys(data).some(k=>!['appliedFacets','limit','offset','searchText'].includes(k)))return {allowed:false,reason:'WORKDAY_SEARCH_PAYLOAD_REJECTED'};
  if(!Number.isInteger(data.limit)||data.limit<1||data.limit>100||!Number.isInteger(data.offset)||data.offset<0||typeof data.searchText!=='string'||data.searchText.length>500||!data.appliedFacets||typeof data.appliedFacets!=='object'||Array.isArray(data.appliedFacets))return {allowed:false,reason:'WORKDAY_SEARCH_PAYLOAD_REJECTED'};
  return {allowed:true,operation:'PUBLIC_VACANCY_SEARCH',reversible:true,submitting:false};
 }
 return {allowed:false,reason:'NO_REVIEWED_READ_POST'};
}
export function safeNavigationButton({adapter,url,button,fields}){
 if(adapter==='generic'||fields.some(f=>f.visible&&f.required)||button.type==='submit'||button.final_submit)return false;
 if(!/^apply(?: for (?:this|the) (?:job|position))?$/i.test(button.text??'')||!button.href)return false;
 const from=new URL(url),to=new URL(button.href,from);
 return ['http:','https:'].includes(to.protocol)&&from.origin===to.origin&&atsAdapterFor(to.href)===adapter&&/\/(?:apply|application)(?:\/|$)/.test(to.pathname);
}
export function observerUrl(value){try{const url=new URL(value);for(const key of [...url.searchParams.keys()])if(/token|password|code|signature|credential|auth|key/i.test(key))url.searchParams.set(key,'[redacted]');url.username='';url.password='';return url.href;}catch{return '';}}
