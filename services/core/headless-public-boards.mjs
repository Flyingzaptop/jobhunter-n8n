import {chromium} from 'playwright';
import {extractJobPostings} from './discovery.mjs';
import {publishedNextPage} from './discovery-cursors.mjs';
import {extractVisibleBoardJob} from './board-document.mjs';
import {boardProfileStatus,openBoardProfile,exportBoardState} from './board-profiles.mjs';
import {ordinaryChromeContext} from './ordinary-chrome.mjs';
import {dismissPracujReadOverlays,pracujNextButton} from './pracuj-overlays.mjs';

export const BOARD_TARGETS = Object.freeze({
  pracuj:{url:'https://www.pracuj.pl/praca',hostname:'www.pracuj.pl',jobPath:/^\/praca\/.+,oferta,\d+\/?$/},
  olx:{url:'https://www.olx.pl/praca/',hostname:'www.olx.pl',jobPath:/^\/(?:d\/oferta|oferta\/praca)\/.+\.html$/},
  linkedin:{url:'https://www.linkedin.com/jobs/search/',hostname:'www.linkedin.com',hosts:['www.linkedin.com','pl.linkedin.com'],jobPath:/^\/jobs\/view\/(?:[^/]+-)?\d+\/?$/},
});
export function boardVacancyLinks(name,links){
  const target=BOARD_TARGETS[name];if(!target)throw new Error('UNKNOWN_BOARD_TARGET');
  const seen=new Set();const jobs=[];
  for(const item of links){try{const url=new URL(item.href,target.url);if(url.protocol!=='https:'||!(target.hosts??[target.hostname]).includes(url.hostname)||!target.jobPath.test(url.pathname))continue;
    url.hash='';url.search='';if(seen.has(url.href))continue;seen.add(url.href);jobs.push({url:url.href,title_hint:String(item.text??'').trim().slice(0,300)});
  }catch{/* Unusable links are not evidence. */}}
  return jobs;
}
export function challengeState({status,title,text,captchaVisible=false}){
  const heading=String(title??'').toLowerCase();const leading=String(text??'').slice(0,1800).toLowerCase();
  if(captchaVisible||/just a moment|attention required|captcha|access denied/.test(heading)||/verify (?:that )?you are human|checking your browser|performing security verification|potwierdź, że jesteś człowiekiem|sprawdź, czy jesteś człowiekiem/.test(leading))return'CHALLENGE_OR_CAPTCHA';
  if(status===403||status===401||status===429)return'HTTP_ACCESS_BLOCKED';
  if(status>=400)return'HTTP_ERROR';
  return null;
}
export function definitiveClosedDetail({status,challenge}){
 return [404,410].includes(status)&&challenge!=='CHALLENGE_OR_CAPTCHA';
}
export function publicBrowserRequestAllowed(url,method){
  if(!['GET','HEAD'].includes(method))return false;
  const parsed=new URL(url);const path=parsed.pathname;
  if(parsed.protocol==='https:'&&parsed.hostname==='massachusetts.pracuj.pl'&&path==='/api/companies/metadata')return true;
  return !/^api\./i.test(parsed.hostname)&&!/^\/(?:api|graphql|ajax|auth|login|logout|konto)(?:\/|$)/i.test(path);
}
async function inspectPage(page,response){
  const title=await page.title();const text=await page.locator('body').innerText({timeout:5000}).catch(()=>'');
  const captchaVisible=await page.locator('iframe[src*="captcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha').evaluateAll(items=>items.some(item=>{const box=item.getBoundingClientRect();return box.width>0&&box.height>0;})).catch(()=>false);
  return{status:response?.status()??null,title,challenge:challengeState({status:response?.status(),title,text,captchaVisible}),body_characters:text.length};
}
export async function probeHeadlessBoards({names=['pracuj','olx'],maxDetails=2,detailOffset=0,listingUrl,snapshotLinks,exactJobUrl,navigationTimeoutMs=20000,allowUrl=()=>true}={}){
  if(names.some(name=>!BOARD_TARGETS[name])||!Number.isInteger(maxDetails)||maxDetails<0||maxDetails>5)throw new Error('INVALID_HEADLESS_PROBE_OPTIONS');
  const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  const report={started_at:new Date().toISOString(),browser:'Playwright Chromium',headless:true,isolated_context:true,gpu_disabled:true,
    cookies_imported:false,user_agent_overridden:false,stealth:false,challenge_solving:false,inference_requests:0,submissions:0,sources:[]};
  try{for(const name of names){
    const target=BOARD_TARGETS[name];const currentUrl=listingUrl??target.url;
    const parsedListing=new URL(currentUrl);const validPath=parsedListing.pathname===new URL(target.url).pathname
      ||name==='olx'&&/^\/praca\/q-[a-zA-Z0-9%_,+-]+\/$/.test(parsedListing.pathname)
      ||name==='pracuj'&&/^\/praca\/[^/]+(?:\/[^/]+;wp)?$/.test(parsedListing.pathname);
    if(parsedListing.origin!==new URL(target.url).origin||!validPath)throw new Error('INVALID_PUBLIC_LISTING_PAGE');
    const profile=await boardProfileStatus(name);
    if(profile.manual_login_active&&name!=='pracuj'){report.sources.push({source:name,url:currentUrl,status:'USER_AUTHENTICATION_IN_PROGRESS',job_links:[],details:[]});continue;}
    const ordinary=name==='pracuj';
    const context=ordinary?await ordinaryChromeContext({directory:'data/board-diagnostics/pracuj-native',port:9127}):profile.prepared?await openBoardProfile(name,{headless:profile.headless}):await browser.newContext();
    // Discovery only: never transmit application forms or interact with authentication.
    const blockedRequests=[];
    await context.route('**/*',route=>{const request=route.request();if(publicBrowserRequestAllowed(request.url(),request.method()))return route.continue();const target=new URL(request.url());blockedRequests.push({host:target.hostname,path:target.pathname,method:request.method()});return route.abort();});
    const page=await context.newPage();const result={source:name,url:currentUrl,status:'UNKNOWN',job_links:[],details:[],blocked_requests:blockedRequests,headless:ordinary?false:profile.prepared?profile.headless:true,access_mode:ordinary?'ORDINARY_CHROME_CDP':profile.prepared?'USER_MANAGED_PROFILE':'ISOLATED_PUBLIC_BROWSER'};
    try{
      const response=await page.goto(currentUrl,{waitUntil:'domcontentloaded',timeout:navigationTimeoutMs});
      await page.waitForLoadState('load',{timeout:5000}).catch(()=>{});
      if(name==='pracuj')await dismissPracujReadOverlays(page).catch(()=>{});
      const state=await inspectPage(page,response);Object.assign(result,state,{http_status:state.status,status:state.challenge??'PUBLIC_PAGE_READABLE'});
      if(!state.challenge){
        const links=await page.locator('a[href]').evaluateAll(items=>items.map(item=>({href:item.href,text:item.innerText,rel:item.rel})));
        result.published_next_page_url=publishedNextPage(links,currentUrl,{pagePattern:name==='olx'?'^'+parsedListing.pathname.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\?page=[0-9]+$':undefined});
        result.observed_job_links=boardVacancyLinks(name,links);
        result.job_links=snapshotLinks?.length?boardVacancyLinks(name,snapshotLinks.map(item=>({href:item.url,text:item.title_hint}))):result.observed_job_links;
        if(exactJobUrl){result.job_links=boardVacancyLinks(name,[{href:exactJobUrl}]);if(result.job_links.length!==1)throw new Error('INVALID_EXACT_PUBLIC_JOB_URL');}
        result.job_link_count=result.job_links.length;
        if(!result.job_links.length)result.status='NO_PUBLIC_VACANCY_LINKS';
        if(name==='pracuj'&&!exactJobUrl&&!result.published_next_page_url){
          const next=pracujNextButton(page);
          if(await next.count()&&await next.isVisible()&&await next.isEnabled()){
            const previous=page.url();await next.click({timeout:5000}).catch(error=>{result.pagination_observation_failed=true;result.pagination_error=String(error.message).slice(0,1000);});
            if(!result.pagination_observation_failed)await page.waitForURL(url=>url.href!==previous,{timeout:5000}).catch(()=>{});
            const observed=new URL(page.url());
            if(observed.href!==previous&&observed.origin===parsedListing.origin)result.published_next_page_url=observed.href;
            else result.pagination_observation_failed=true;
          }else result.listing_end_observed=true;
        }
        const offset=detailOffset%(result.job_links.length||1);result.next_listing_offset=offset+Math.min(maxDetails,result.job_links.length-offset);
        for(const job of result.job_links.slice(offset,offset+maxDetails)){
          if(!allowUrl(job.url)){result.status='PUBLIC_POLICY_DENIED';break;}
          const detail={url:job.url,status:'UNKNOWN'};try{
            const detailResponse=await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:navigationTimeoutMs});
            const detailState=await inspectPage(page,detailResponse);Object.assign(detail,{http_status:detailState.status,status:detailState.challenge??'PUBLIC_DETAIL_READABLE',title:detailState.title});
            if(definitiveClosedDetail(detailState))detail.status='CONFIRMED_CLOSED';
            else if(!detailState.challenge){
              const html=await page.content();detail.job_postings=extractJobPostings(html);
              if(name==='pracuj'&&detail.job_postings.length===1){
                const badges=await page.locator('[data-test="offer-badge-title"]').allTextContents();
                const formats=badges.map(text=>({quote:text.trim(),mode:/^praca stacjonarna$/i.test(text.trim())?'ONSITE':/^praca hybrydowa$/i.test(text.trim())?'HYBRID':/^praca zdalna$/i.test(text.trim())?'REMOTE':null})).filter(item=>item.mode);
                if(formats.length===1){const posting=detail.job_postings[0];posting.work_mode=formats[0].mode;posting.description=(posting.description??'')+'\nWork format: '+formats[0].quote;posting.work_format_evidence={method:'VISIBLE_OFFER_BADGE',quote:formats[0].quote};}
              }
              if(!detail.job_postings.length){const extracted=await extractVisibleBoardJob(page,name);if(extracted)detail.job_postings=[extracted];}
              detail.structured_job_count=detail.job_postings.length;
              if(!detail.job_postings.length)detail.status='PUBLIC_DETAIL_WITHOUT_JOBPOSTING';
            }
          }catch(error){detail.status='DETAIL_TRANSPORT_ERROR';detail.error=String(error.message).split('\n')[0].slice(0,250);}
          result.details.push(detail);if(['CHALLENGE_OR_CAPTCHA','HTTP_ACCESS_BLOCKED'].includes(detail.status)){result.status='PARTIAL_ACCESS_BLOCKED';break;}
        }
      }
    }catch(error){result.status='BROWSER_TRANSPORT_ERROR';result.error=String(error.message).split('\n')[0].slice(0,250);}
    finally{if(profile.prepared&&!ordinary)await exportBoardState(context,name).catch(()=>{});await context.close();}
    report.sources.push(result);
  }}finally{await browser.close();}
  report.completed_at=new Date().toISOString();return report;
}
