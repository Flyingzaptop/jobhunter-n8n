import test from 'node:test';
import assert from 'node:assert/strict';
import {boardVacancyLinks,challengeState,publicBrowserRequestAllowed} from '../scripts/headless-board-probe.mjs';

test('board links require exact public platform host and vacancy path, dedupe and discard tracking',()=>{
 const links=[{href:'https://www.pracuj.pl/praca/mechanical-engineer-wroclaw,oferta,1001234567?utm_source=x',text:'Mechanical engineer'},
  {href:'/praca/mechanical-engineer-wroclaw,oferta,1001234567#apply',text:'Apply'},
  {href:'https://evil.example/praca/mechanical-engineer,oferta,1001234567'},
  {href:'https://www.pracuj.pl/konto/login'},{href:'javascript:void(0)'}];
 assert.deepEqual(boardVacancyLinks('pracuj',links),[{url:'https://www.pracuj.pl/praca/mechanical-engineer-wroclaw,oferta,1001234567',title_hint:'Mechanical engineer'}]);
 assert.equal(boardVacancyLinks('olx',[{href:'/d/oferta/mechanik-CID4-ID123.html'},{href:'/oferta/praca/mechanik-CID4-ID124.html'},{href:'/praca/'}]).length,2);
});
test('ordinary public browser requests reject submissions, private APIs and auth endpoints',()=>{
 assert.equal(publicBrowserRequestAllowed('https://www.olx.pl/praca/','GET'),true);
 assert.equal(publicBrowserRequestAllowed('https://www.olx.pl/api/v1/offers','GET'),false);
 assert.equal(publicBrowserRequestAllowed('https://www.olx.pl/auth/login','GET'),false);
 assert.equal(publicBrowserRequestAllowed('https://www.olx.pl/praca/','POST'),false);
});
test('headless challenges and blocked HTTP responses never become readable discovery evidence',()=>{
 assert.equal(challengeState({status:200,title:'Just a moment...',text:'Loading'}),'CHALLENGE_OR_CAPTCHA');
 assert.equal(challengeState({status:403,title:'Forbidden'}),'HTTP_ACCESS_BLOCKED');
 assert.equal(challengeState({status:200,title:'Jobs',captchaVisible:true}),'CHALLENGE_OR_CAPTCHA');
 assert.equal(challengeState({status:200,title:'Oferty pracy',text:'Mechanical engineering vacancies'}),null);
});
