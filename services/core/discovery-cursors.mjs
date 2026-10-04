import {decodeEntities} from './discovery.mjs';

export function publishedNextPage(links,currentUrl,{pagePattern}={}){
  const current=new URL(currentUrl);const pattern=pagePattern?new RegExp(pagePattern):null;
  for(const item of links){
    if(!/(?:^|\s)next(?:\s|$)/i.test(item.rel??'')&&!/^(?:nast[eę]pna|dalej|next|next page|nast[eę]pna strona)\s*[»›→]?$/i.test(String(item.text??'').trim()))continue;
    try{const url=new URL(decodeEntities(item.href),currentUrl);url.hash='';
      if(url.protocol!=='https:'||url.origin!==current.origin||url.href===current.href||pattern&&!pattern.test(url.pathname+url.search))continue;
      return url.href;
    }catch{/* Only published usable same-origin pagination links are followed. */}
  }
  return null;
}
export function htmlPaginationLinks(text){
  return [...String(text).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(([,attrs,body])=>{
    const href=attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    return href?[{href,rel:attrs.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]??'',text:decodeEntities(body.replace(/<[^>]*>/g,'').trim())}]:[];
  });
}
export function listingCursor({rootUrl,currentUrl,nextUrl,total,offset,processed}){
  const nextOffset=offset+processed;const pageCompleted=nextOffset>=total;
  const cycleCompleted=pageCompleted&&!nextUrl;
  return{listing_page_url:currentUrl,listing_page_completed:pageCompleted,cycle_completed:cycleCompleted,
    coverage_status:cycleCompleted?'OBSERVED_LISTING_CYCLE_COMPLETE':'INCREMENTAL_SCAN_PENDING',
    next_listing_page_url:pageCompleted?(nextUrl??rootUrl):currentUrl,
    next_listing_offset:pageCompleted?0:nextOffset,truncated:!cycleCompleted};
}
