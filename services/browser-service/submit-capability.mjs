import {createHmac,timingSafeEqual} from 'node:crypto';
import {digest,formBinding} from '../dashboard/review-gates.mjs';
export function issueSubmitCapability({secret,approvalId,applicationId,snapshot,source='USER_DASHBOARD',now=Date.now()}){
 if(typeof secret!=='string'||secret.length<16)throw new Error('SUBMIT_SIGNING_SECRET_REQUIRED');
 if(!['USER_DASHBOARD','USER_TELEGRAM','USER_AUTONOMOUS'].includes(source))throw new Error('INVALID_CONFIRMATION_SOURCE');
 const data={source,approval_id:approvalId,application_id:applicationId,
  session_id:snapshot.browser_session_id,url:snapshot.url,state_hash:digest(formBinding(snapshot)),expires_at:now+120000};
 const encoded=Buffer.from(JSON.stringify(data)).toString('base64url');
 return encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url');
}
export function verifySubmitCapability(token,{secret,applicationId,snapshot,now=Date.now()}){
 if(typeof token!=='string'||token.length>4096||typeof secret!=='string'||secret.length<16)throw new Error('EXPLICIT_SUBMIT_CAPABILITY_REQUIRED');
 const [encoded,signature,...extra]=token.split('.');if(extra.length||!encoded||!signature)throw new Error('INVALID_SUBMIT_CAPABILITY');
 const expected=createHmac('sha256',secret).update(encoded).digest(),actual=Buffer.from(signature,'base64url');
 if(actual.length!==expected.length||!timingSafeEqual(expected,actual))throw new Error('INVALID_SUBMIT_CAPABILITY');
 let data;try{data=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw new Error('INVALID_SUBMIT_CAPABILITY');}
 if(!['USER_DASHBOARD','USER_TELEGRAM','USER_AUTONOMOUS'].includes(data.source)||data.application_id!==applicationId||data.session_id!==snapshot.browser_session_id||data.url!==snapshot.url
  ||data.state_hash!==digest(formBinding(snapshot))||!Number.isFinite(data.expires_at)||data.expires_at<=now||data.expires_at>now+120000)
  throw new Error('SUBMIT_CAPABILITY_STALE_OR_WRONG_APPLICATION');
 return data;
}
