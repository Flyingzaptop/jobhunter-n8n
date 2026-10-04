import test from 'node:test';import assert from 'node:assert/strict';
import {nextDetailState} from '../services/core/board-document.mjs';
import {pracujNextButton} from '../services/core/pracuj-overlays.mjs';

test('Pracuj responsive duplicate next buttons select one visible control',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();
  await page.setContent('<button data-test="bottom-pagination-button-next" style="display:none">Hidden</button><button data-test="bottom-pagination-button-next">Next</button><button data-test="bottom-pagination-button-next">Second visible copy</button>');
  const next=pracujNextButton(page);
  assert.equal(await next.count(),1);assert.equal(await next.isVisible(),true);
  assert.equal(await next.innerText(),'Next');await next.click();
 }finally{await browser.close();}
});

test('detail retries retain original listing provenance and normalization failures until proven read or closed',()=>{
 const now=new Date('2026-10-05T00:00:00Z');
 const first=nextDetailState([],[{url:'https://board.example/job',listing_url:'https://board.example/page/1',status:'NORMALIZATION_FAILED'}],now);
 const again=nextDetailState(first,[{url:first[0].url,status:'DETAIL_TRANSPORT_ERROR'}],now);
 assert.equal(again[0].listing_url,first[0].listing_url);
 assert.equal(again[0].attempts,2);
 assert.equal(again[0].next_retry_at,'2026-10-05T00:05:00.000Z');
 assert.equal(nextDetailState(again,[{url:first[0].url,status:'CONFIRMED_CLOSED'}],now).length,0);
});
import {boardProfilePath} from '../services/core/board-profiles.mjs';
import {chromium} from 'playwright';
import {extractVisibleBoardJob} from '../services/core/board-document.mjs';
import {publicListingJobUrls} from '../services/core/discovery-v2.mjs';
test('regional vacancy URLs require an explicit trusted host list',()=>{
 const source={url:'https://www.linkedin.com/jobs/search/',job_link_pattern:'^/jobs/view/.+',regional_listing_hosts:['pl.linkedin.com']};
 const html='<a href="https://pl.linkedin.com/jobs/view/role-123">role</a><a href="https://linkedin.com.evil.invalid/jobs/view/123">bad</a>';
 assert.deepEqual(publicListingJobUrls(source,html),['https://pl.linkedin.com/jobs/view/role-123']);
 assert.equal(publicListingJobUrls({...source,regional_listing_hosts:[]},html).length,0);
});
test('visible OLX extraction preserves exact description and does not invent missing date or employer',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();const text='Mechanical design and CAD prototyping. '.repeat(8);
  await page.setContent(`<h1>Junior Mechanical Engineer</h1><div data-testid="ad-description">${text}</div>`);
  const posting=await extractVisibleBoardJob(page,'olx');assert.equal(posting.title,'Junior Mechanical Engineer');
  assert.equal(posting.description,text.trim());assert.equal(Object.hasOwn(posting,'datePublished'),false);
  assert.equal(Object.hasOwn(posting,'hiringOrganization'),false);assert.equal(posting.extraction_evidence.method,'VISIBLE_BOARD_DOM');
 }finally{await browser.close();}
});
test('failed details survive pagination and only verified reads remove the exact retry',()=>{
 const now=new Date('2026-10-04T00:00:00Z');
 const pending=nextDetailState([], [{url:'https://www.olx.pl/a',status:'DETAIL_TRANSPORT_ERROR'}],now);
 assert.equal(pending.length,1);assert.equal(pending[0].next_retry_at,'2026-10-04T00:05:00.000Z');
 assert.equal(nextDetailState(pending,[]).length,1);
 assert.equal(nextDetailState(pending,[{url:pending[0].url,status:'PUBLIC_DETAIL_READABLE',structured_job_count:0}],now)[0].attempts,2);
 assert.equal(nextDetailState(pending,[{url:pending[0].url,status:'PUBLIC_DETAIL_READABLE',structured_job_count:1}],now).length,0);
});
test('browser profiles cannot be selected using arbitrary paths',()=>{
 for(const board of ['../private','C:/secrets','olx/../../private','constructor'])assert.throws(()=>boardProfilePath(board),/UNKNOWN_BOARD_PROFILE/);
 assert.match(boardProfilePath('pracuj'),/pracuj$/);
});
