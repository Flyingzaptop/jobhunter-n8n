const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase().trim();
export function declaredWorkMode(value){const text=fold(value);
 if(/hybrid|hybryd/.test(text))return 'HYBRID';
 if(/remote|telecommute|zdaln/.test(text))return 'REMOTE';
 if(/on[-_ ]?site|in[-_ ]?office|stacjonarn/.test(text))return 'ONSITE';return 'UNKNOWN';}
export function explicitWorkMode(job){
 const declared=declaredWorkMode(job.work_mode??job.workplaceType??job.jobLocationType);
 if(declared!=='UNKNOWN')return {mode:declared,quote:String(job.work_mode??job.workplaceType??job.jobLocationType),source_field:'work_mode'};
 const lines=String(job.description_text??job.description??'').split(/\n|(?<=[.!?])\s+/);
 const candidates=lines.filter(line=>!/(?:not|no|without|nie|brak)\s+(?:required\s+)?(?:on[- ]?site|in[- ]?office|praca|pracy)|optional|opcjonaln/i.test(line))
  .filter(line=>/^(?:work (?:format|mode)|tryb pracy|model pracy)\s*:|^praca (?:stacjonarna|hybrydowa|zdalna)\s*[.!]?\s*$|^(?:this|the)\s+(?:role|job|position)\s+(?:is|requires|will be)\b|^\s*(?:on[- ]?site|hybrid|fully remote|remote)\s+(?:role|position|work)/i.test(fold(line)))
  .map(line=>({mode:declaredWorkMode(line),quote:line.trim(),source_field:'description_text'})).filter(row=>row.mode!=='UNKNOWN');
 const modes=[...new Set(candidates.map(row=>row.mode))];return modes.length===1?candidates[0]:{mode:'UNKNOWN',quote:null,source_field:null,conflict:modes.length>1};
}
export function enrichPostingWorkMode(posting,{html,url}){
 let host;try{host=new URL(url).hostname;}catch{return posting;}
 if(!/(?:^|\.)praca\.pl$/.test(host))return posting;
 const quotes=[...String(html).matchAll(/<div\b[^>]*class=["'][^"']*\bapp-offer__header-item--home\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
  .flatMap(match=>[...match[1].matchAll(/<span\b[^>]*>([^<]*)<\/span>/gi)].map(m=>m[1].trim()));
 const formats=quotes.map(quote=>({quote,mode:declaredWorkMode(quote)})).filter(f=>f.mode!=='UNKNOWN');
 if(formats.length!==1)return posting;
 const {mode,quote}=formats[0];return {...posting,work_mode:mode,
  description:(posting.description??'')+'\nWork format: '+quote,
  work_format_evidence:{method:'OFFER_WORK_FORMAT_BADGE',quote,source_url:url}};
}
