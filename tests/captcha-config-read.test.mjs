import test from 'node:test';import assert from 'node:assert/strict';import {reviewedCaptchaConfigRead} from '../services/browser-service/captcha-config-read.mjs';
test('provider setup can render a human challenge, but never authorizes solving or another host',()=>{
 const request={url:'https://api.hcaptcha.com/checksiteconfig?host=jobs.lever.co&sitekey=public-key&v=version',pageUrl:'https://jobs.lever.co/acme/id/apply',method:'POST',body:Buffer.alloc(0)};
 assert.equal(reviewedCaptchaConfigRead(request),true);
 assert.equal(reviewedCaptchaConfigRead({...request,url:'https://api.hcaptcha.com/checkcaptcha/key'}),false);
 assert.equal(reviewedCaptchaConfigRead({...request,body:Buffer.from('answers=solution')}),false);
 assert.equal(reviewedCaptchaConfigRead({...request,pageUrl:'https://evil.example'}),false);
});
