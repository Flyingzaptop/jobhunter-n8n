import {factIndex} from './fit.mjs';

const scope={ACADEMIC:'Academic project',PERSONAL_PROJECT:'Personal project',INDEPENDENT_R_AND_D:'Independent R&D',PROFESSIONAL:'Professional experience',EDUCATION:'Studies in progress',COURSE:'Course'};
const words=text=>new Set(String(text).toLowerCase().match(/[\p{L}\d+#.-]{3,}/gu)??[]);
const clean=text=>String(text).replace(/;\s*reinforcement-learning work may be referenced only where documented in project evidence\.?/gi,'');
const skillText=x=>typeof x==='string'?x:Object.entries(x).map(([k,v])=>`${k}: ${v}`).join('; ');
const claim=(text,id)=>({text,source_fact_ids:[id]});

// No new prose or employer claims: only source clauses and labelled metadata.
export function extractivePhrases(fact){
 const title=fact.role??fact.title??fact.field??fact.statements?.[0];
 const phrases=[...(fact.statements??[]).filter(x=>typeof x==='string').map(clean)];
 if(title)phrases.push(`${scope[fact.provenance]??'Verified background'}: ${title}${fact.provenance==='EDUCATION'&&fact.status==='degree_in_progress'?' (degree in progress)':''}.`);
 if(fact.skills?.length)phrases.push(`Tools and skills: ${fact.skills.map(s=>skillText(s).replaceAll('_',' ')).join(', ')}.`);
 return [...new Set(phrases)].filter(text=>text.length>0&&text.length<=550);
}

export function composeExtractiveCv({catalog,job}){
 const {index,tailoring,skills}=catalog,requested=words(`${job.title} ${job.description_text}`);
 const relevance=text=>[...words(text)].filter(w=>requested.has(w)).length;
 const ordered=id=>extractivePhrases(index.get(id)).sort((a,b)=>relevance(b)-relevance(a));
 const sections=[...tailoring.allowed_section_ids].sort((a,b)=>(tailoring.scores[b]??0)-(tailoring.scores[a]??0)).map(id=>{
   const limit=tailoring.secondary_fact_ids.includes(id)?1:4;
   const f=index.get(id),sentences=(f.statements??[]).filter(s=>typeof s==='string').map(clean).sort((a,b)=>relevance(b)-relevance(a));
   const tools=extractivePhrases(f).find(s=>s.startsWith('Tools and skills:'));
   const selected=sentences.slice(0,limit);if(tools&&limit>1&&selected.length<limit)selected.push(tools);
   return {source_fact_id:id,bullets:(selected.length?selected:ordered(id).slice(0,1)).map(text=>claim(text,id))};
 }).filter(s=>s.bullets.length);
 const primary=tailoring.primary_fact_ids.map(id=>index.get(id)).filter(f=>f&&(f.role||f.title||f.field||f.statements?.length));
 const engineering=tailoring.engineering_education_first?primary.find(f=>/mechanical|engineering|embedded|automation|robotic|simulation|cad|gearbox|turbine|plc/i.test(f.role??f.title??f.field??f.statements?.[0]??'')):null;
 const lead=engineering??primary[0]??index.get(sections[0]?.source_fact_id);
 if(!lead)return null;
 const title=lead.role??lead.title??lead.field??lead.statements?.[0];
 let headline=claim(`${scope[lead.provenance]??'Verified background'}: ${title}${lead.provenance==='EDUCATION'&&lead.status==='degree_in_progress'?' (degree in progress)':''}.`,lead.id);
 if(tailoring.engineering_education_first&&!/mechanical|engineering|embedded|automation|robotic|simulation|cad|gearbox|turbine|plc/i.test(headline.text)){
  const education=[...index.values()].find(f=>f.provenance==='EDUCATION'&&f.status==='degree_in_progress'&&/engineering|mechanical/i.test(f.field??''));
  if(education)headline={text:`${education.field} (degree in progress) | ${headline.text}`,source_fact_ids:[...new Set([education.id,lead.id])]};
 }
 const summaryFacts=primary.filter(f=>f.statements?.length).slice(0,2);
 if(!summaryFacts.length)summaryFacts.push(lead);
 const summary=summaryFacts.map(f=>{
   const text=ordered(f.id).find(x=>!x.startsWith('Tools and skills:'))??headline.text;
   const label=scope[f.provenance];
   return claim(label&&!text.startsWith(label)?`${label}: ${text}`:text,f.id);
 });
 return {headline,summary,skills:skills.slice(0,14).map(s=>({...s,source_fact_ids:s.source_fact_ids.slice(0,6)})),sections,application_text:[]};
}

export function verifyExtractiveCv(document,profile,allowedSkills){
 const facts=factIndex(profile),checks=[];
 const check=(c,kind)=>{
   const id=c.source_fact_ids?.[0],f=facts.get(id);
   const options=f?extractivePhrases(f):[];
   const title=f?.role??f?.title??f?.field??f?.statements?.[0];
   if(title)options.push(`${scope[f.provenance]??'Verified background'}: ${title}${f.provenance==='EDUCATION'&&f.status==='degree_in_progress'?' (degree in progress)':''}.`);
   const composedEngineering=kind==='headline'&&c.source_fact_ids?.length===2&&c.source_fact_ids.some(educationId=>{const e=facts.get(educationId);if(e?.provenance!=='EDUCATION'||e.status!=='degree_in_progress')return false;const other=facts.get(c.source_fact_ids.find(x=>x!==educationId));return other&&extractivePhrases(other).some(text=>`${e.field} (degree in progress) | ${text}`===c.text);});
   const supported=kind==='skill'?allowedSkills.some(s=>s.text===c.text&&c.source_fact_ids.length>0&&c.source_fact_ids.every(id=>s.source_fact_ids.includes(id))):c.source_fact_ids?.length===1&&options.some(text=>text===c.text||kind==='summary'&&scope[f.provenance]&&`${scope[f.provenance]}: ${text}`===c.text);
   checks.push({claim_id:`claim_${checks.length}`,verdict:supported||composedEngineering?'SUPPORTED':'UNSUPPORTED',reason:'Exact source clause or provenance-labelled metadata'});
 };
 check(document.headline,'headline');document.summary.forEach(c=>check(c,'summary'));document.skills.forEach(c=>check(c,'skill'));document.sections.forEach(s=>s.bullets.forEach(c=>check(c,'bullet')));
 document.application_text.forEach(t=>t.claims.forEach(c=>checks.push({claim_id:`claim_${checks.length}`,verdict:'UNSUPPORTED',reason:'Application prose requires separate verification'})));
 return {pass:checks.every(c=>c.verdict==='SUPPORTED'),method:'EXACT_SOURCE_CLAUSES_AND_LABELLED_METADATA',model:null,checks,batches:[],model_requests:0};
}
