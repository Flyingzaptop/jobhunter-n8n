import {createHash} from 'node:crypto';

export function guestPagination({currentUrl,jobUrls,previousFingerprint,previousUrl}) {
 const current=new URL(currentUrl), offset=Number(current.searchParams.get('start')??0);
 if(!Number.isInteger(offset)||offset<0) throw new Error('GUEST_SEARCH_OFFSET_INVALID');
 const fingerprint=createHash('sha256').update([...new Set(jobUrls)].sort().join('\n')).digest('hex');
 if(offset>=1000) return {nextUrl:null,complete:false,status:'PUBLIC_GUEST_RESULT_WINDOW_CAPPED',fingerprint};
 if(!jobUrls.length) return {nextUrl:null,complete:true,status:'PUBLIC_GUEST_WINDOW_END_OBSERVED',fingerprint};
 if(previousUrl && previousUrl!==currentUrl && previousFingerprint===fingerprint)
  return {nextUrl:null,complete:false,status:'PUBLIC_GUEST_PAGINATION_REPEATED',fingerprint};
 current.searchParams.set('start',String(offset+new Set(jobUrls).size));
 return {nextUrl:current.href,complete:false,status:'PUBLIC_GUEST_WINDOW_IN_PROGRESS',fingerprint};
}
