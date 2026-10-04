import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const accessError=code=>Object.assign(new Error(code),{status:401,code});
const active=({grant,application,handoff,profileId})=>grant.candidate_profile_id===profileId&&!grant.revoked_at&&new Date(grant.expires_at)>new Date()&&application.candidate_profile_id===profileId&&application.status==='MANUAL_TAKEOVER'&&application.last_state?.reason==='INTERACTIVE_CAPTCHA'&&application.dry_run===true&&!application.confirmation_id&&!application.submitted_at&&!handoff.resolved_at&&handoff.handoff_id===application.last_state?.captcha_handoff?.handoff_id&&handoff.browser_session_id===application.last_state?.browser_session_id&&grant.browser_session_id===handoff.browser_session_id&&grant.handoff_id===handoff.handoff_id;
export async function issueCaptchaAccess({repository,handoffId,profileId,ttlMs=30*60*1000}){
 if(!Number.isInteger(ttlMs)||ttlMs<15*60*1000||ttlMs>30*60*1000)throw new Error('INVALID_CAPTCHA_ACCESS_TTL');
 const client=await repository.pool.connect();try{
  await client.query('BEGIN');
  const row=(await client.query('SELECT * FROM captcha_handoffs WHERE handoff_id=$1',[handoffId])).rows[0];
  if(!row)throw accessError('CAPTCHA_ACCESS_HANDOFF_NOT_FOUND');
  const app=(await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE',[row.application_id])).rows[0];
  await client.query('SELECT handoff_id FROM captcha_handoffs WHERE handoff_id=$1 FOR UPDATE',[handoffId]);
  const salt=randomBytes(16).toString('hex'),token=randomBytes(32).toString('base64url'),grant={handoff_id:handoffId,candidate_profile_id:profileId,browser_session_id:row.browser_session_id,revoked_at:null,expires_at:new Date(Date.now()+ttlMs)};
  if(!app||!active({grant,application:app,handoff:row,profileId}))throw accessError('CAPTCHA_ACCESS_HANDOFF_STALE');
  await client.query('UPDATE captcha_access_grants SET revoked_at=now() WHERE handoff_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[handoffId]);
  const grantId=randomUUID();await client.query('INSERT INTO captcha_access_grants(grant_id,handoff_id,application_id,candidate_profile_id,browser_session_id,token_salt,token_hash,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[grantId,handoffId,row.application_id,profileId,row.browser_session_id,salt,hash(salt+'\0'+token),grant.expires_at]);
  await client.query('COMMIT');const url=new URL(row.dashboard_url);url.pathname=`/manual-captcha/${row.application_id}`;url.search='';url.hash='access='+token;return {url:url.href,grant_id:grantId,expires_at:grant.expires_at.toISOString()};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function exchangeCaptchaAccess({repository,applicationId,token,profileId}){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw accessError('CAPTCHA_ACCESS_INVALID_OR_EXPIRED');
 const client=await repository.pool.connect();try{
  await client.query('BEGIN');
  const app=(await client.query('SELECT * FROM applications WHERE application_id=$1 FOR UPDATE',[applicationId])).rows[0];
  const rows=(await client.query('SELECT * FROM captcha_access_grants WHERE application_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',[applicationId])).rows;
  const grant=rows.find(r=>equal(hash(r.token_salt+'\0'+token),r.token_hash));
  if(!grant)throw accessError('CAPTCHA_ACCESS_INVALID_OR_EXPIRED');
  const handoff=(await client.query('SELECT * FROM captcha_handoffs WHERE handoff_id=$1',[grant.handoff_id])).rows[0];
  if(!app||!handoff||!active({grant,application:app,handoff,profileId}))throw accessError('CAPTCHA_ACCESS_SCOPE_STALE');
  const cookie=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  await client.query('UPDATE captcha_access_grants SET consumed_at=now(),cookie_hash=$2,csrf_hash=$3 WHERE grant_id=$1',[grant.grant_id,hash(cookie),hash(csrf)]);
  await client.query('COMMIT');return {cookie,csrf,grant_id:grant.grant_id,expires_at:grant.expires_at,application_id:applicationId};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function captchaAccessSession({repository,req,applicationId,profileId}){
 const cookie=/(?:^|;\s*)jobhunter_captcha=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1];if(!cookie)return null;
 const grant=(await repository.pool.query('SELECT * FROM captcha_access_grants WHERE application_id=$1 AND cookie_hash=$2 AND consumed_at IS NOT NULL AND revoked_at IS NULL AND expires_at>now()',[applicationId,hash(cookie)])).rows[0];if(!grant)return null;
 const app=(await repository.pool.query('SELECT * FROM applications WHERE application_id=$1',[applicationId])).rows[0],handoff=(await repository.pool.query('SELECT * FROM captcha_handoffs WHERE handoff_id=$1',[grant.handoff_id])).rows[0];
 return app&&handoff&&active({grant,application:app,handoff,profileId})?grant:null;
}
export function checkCaptchaCsrf(req,grant){const supplied=req.headers['x-csrf-token'];if(typeof supplied!=='string'||!equal(hash(supplied),grant.csrf_hash))throw Object.assign(new Error('CSRF validation failed'),{status:403});}
export async function rotateCaptchaCsrf(repository,grant){const csrf=randomBytes(32).toString('hex');await repository.pool.query('UPDATE captcha_access_grants SET csrf_hash=$2 WHERE grant_id=$1',[grant.grant_id,hash(csrf)]);return csrf;}
