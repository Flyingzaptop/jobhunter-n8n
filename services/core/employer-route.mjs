import {readFile} from 'node:fs/promises';import YAML from 'yaml';
const norm=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const cache=new Map();
export function matchOfficialRoute(job,source,postings){
 if(norm(job.company)!==norm(source.company)||source.adapter!=='greenhouse'||!source.permitted_access)return null;
 const matches=postings.filter(p=>norm(p.title)===norm(job.title));if(matches.length!==1)return null;
 const posting=matches[0];let url;try{url=new URL(posting.absolute_url);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||!['job-boards.greenhouse.io','boards.greenhouse.io','job-boards.eu.greenhouse.io'].includes(url.hostname)||url.pathname!==`/${source.board}/jobs/${posting.id}`)return null;
 return {url:url.href,source_name:source.name,source_item_id:String(posting.id),title:posting.title,method:'CONFIGURED_OFFICIAL_BOARD_EXACT_COMPANY_AND_TITLE'};
}
export async function resolveEmployerRoute({repository,job,fetchImpl=fetch}){
 let host;try{host=new URL(job.application_url??job.canonical_url).hostname;}catch{return null;}
 if(!['himalayas.app','jobicy.com'].includes(host))return null;
 const catalog=YAML.parse(await readFile('config/market_sources.yaml','utf8'));
 const sources=(catalog.sources??[]).filter(s=>s.enabled&&s.permitted_access&&s.adapter==='greenhouse'&&norm(s.company)===norm(job.company));
 for(const source of sources){let entry=cache.get(source.name);if(!entry||Date.now()-entry.at>600000){const response=await fetchImpl(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs`,{signal:AbortSignal.timeout(15000)});if(!response.ok)continue;const data=await response.json();if(!Array.isArray(data.jobs))continue;entry={at:Date.now(),jobs:data.jobs};cache.set(source.name,entry);}
  const route=matchOfficialRoute(job,source,entry.jobs);if(!route)continue;
  await repository.pool.query('UPDATE jobs SET application_url=$2,metadata=metadata||$3::jsonb WHERE job_id=$1',[job.job_id,route.url,{application_route:route}]);
  await repository.pool.query('INSERT INTO job_sources(job_id,source_name,source_url,source_item_id)VALUES($1,$2,$3,$4)ON CONFLICT(job_id,source_name,source_url)DO UPDATE SET last_seen_at=now()',[job.job_id,route.source_name,route.url,route.source_item_id]);
  await repository.event('job',job.job_id,'OFFICIAL_APPLICATION_ROUTE_RESOLVED',route);return route;
 }
 return null;
}
