import test from 'node:test';
import assert from 'node:assert/strict';
import {guestPagination} from '../services/core/guest-pagination.mjs';
const currentUrl='https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=CAD&start=0';
test('guest offset follows actual distinct results and preserves query',()=>{
 const page=guestPagination({currentUrl,jobUrls:['a','b','b']});
 assert.equal(new URL(page.nextUrl).searchParams.get('start'),'2');
 assert.equal(new URL(page.nextUrl).searchParams.get('keywords'),'CAD');
 assert.equal(page.complete,false);
 assert.equal(guestPagination({currentUrl:page.nextUrl,jobUrls:[]}).complete,true);
});
test('repeated pages and guest cap remain incomplete rather than empty success',()=>{
 const first=guestPagination({currentUrl,jobUrls:['a','b']});
 const repeated=guestPagination({currentUrl:first.nextUrl,jobUrls:['b','a'],previousUrl:currentUrl,previousFingerprint:first.fingerprint});
 assert.equal(repeated.complete,false);assert.equal(repeated.status,'PUBLIC_GUEST_PAGINATION_REPEATED');
 const cap=guestPagination({currentUrl:currentUrl.replace('start=0','start=1000'),jobUrls:[]});
 assert.equal(cap.complete,false);assert.equal(cap.status,'PUBLIC_GUEST_RESULT_WINDOW_CAPPED');
});
