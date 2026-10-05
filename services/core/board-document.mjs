export async function extractVisibleBoardJob(page,board){
 const selectors={
  olx:{title:'h1',description:'[data-testid="ad-description"]',company:'[data-testid="user-profile-link"], [data-testid="employer-name"]'},
  pracuj:{title:'h1',description:'[data-test="section-description"], [data-test="section-responsibilities"], [data-test="section-requirements"]',company:'[data-test="text-employerName"], [data-test="text-company-name"]'},
  linkedin:{title:'h1',description:'.show-more-less-html__markup, .jobs-description__content',company:'.topcard__org-name-link, .job-details-jobs-unified-top-card__company-name'},
  praca:{title:'h1',description:'.job-description, [itemprop="description"]',company:'[itemprop="hiringOrganization"]'},
 }[board];
 if(!selectors)throw new Error('UNKNOWN_BOARD_DOCUMENT');
 return page.evaluate(({selectors,board})=>{
  const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
  const read=selector=>[...document.querySelectorAll(selector)].filter(visible).map(e=>e.innerText?.trim()).filter(Boolean).join('\n\n');
  const title=read(selectors.title),description=read(selectors.description),company=read(selectors.company);
  if(!title||description.length<120)return null;
  const main=document.querySelector('main')??document.body;
  const time=[...main.querySelectorAll('time[datetime]')].find(e=>{
   const label=e.getAttribute('aria-label')??e.parentElement?.innerText??'';
   return visible(e)&&(/^(?:datePosted|datePublished)$/.test(e.getAttribute('itemprop')??'')||
    label.length<=240&&/(?:published|posted|date posted|dodano|opublikowano|zamieszczono)/i.test(label));
  });
  const datePublished=time?.getAttribute('datetime');
  const applyLinks=[...main.querySelectorAll('a[href]')].filter(e=>visible(e)&&/^(?:aplikuj(?: teraz| szybko)?|apply(?: now| on company website)?)$/i.test(e.innerText.trim())).map(e=>e.href);
  return {'@type':'JobPosting',title,description,url:location.href,
   ...(company?{hiringOrganization:{name:company}}:{}),
   ...(datePublished?{datePublished}:{}),
   extraction_evidence:{method:'VISIBLE_BOARD_DOM',board,checked_at:new Date().toISOString(),
    selectors,title_quote:title,company_quote:company||null,published_date_quote:time?.innerText?.trim()||null,
    apply_links:[...new Set(applyLinks)]},
  };
 },{selectors,board});
}

export function nextDetailState(previous,details,now=new Date()){
 const pending=new Map((previous??[]).map(item=>[item.url,item]));
 for(const detail of details){
  if(detail.status==='CONFIRMED_CLOSED'||detail.status==='PUBLIC_DETAIL_READABLE'&&detail.structured_job_count===1){pending.delete(detail.url);continue;}
  const earlier=pending.get(detail.url);
  pending.set(detail.url,{...earlier,url:detail.url,...(detail.listing_url?{listing_url:detail.listing_url}:{}),error_code:detail.status,attempts:(earlier?.attempts??0)+1,
   next_retry_at:new Date(now.getTime()+300000).toISOString()});
 }
 return [...pending.values()];
}
