export function confirmedSubmissionResult(result) {
 if(result?.status==='MANUAL_TAKEOVER'&&result.reason==='SUBMIT_CALLBACK_NOT_DISPATCHED'&&result.transport_evidence?.state==='NOT_DISPATCHED'&&result.transport_evidence.browser_session_id===result.browser_session_id&&typeof result.screenshot_path==='string')return {status:'MANUAL_TAKEOVER',reason:result.reason,browser_session_id:result.browser_session_id,transport_evidence:result.transport_evidence,screenshot_path:result.screenshot_path,confirmation_id:null};
 if(result?.status==='MANUAL_TAKEOVER'&&result.reason==='INTERACTIVE_CAPTCHA'&&result.captcha===true&&result.transport_evidence?.state==='NOT_DISPATCHED'&&result.transport_evidence.browser_session_id===result.browser_session_id)return {status:'MANUAL_TAKEOVER',reason:'INTERACTIVE_CAPTCHA',browser_session_id:result.browser_session_id,transport_evidence:result.transport_evidence,screenshot_path:result.screenshot_path,confirmation_id:null};
 const errors=Array.isArray(result?.validation_errors)?result.validation_errors:[];
 const policyDenied=result?.status==='SUBMISSION_UNKNOWN'&&typeof result?.screenshot_path==='string'&&errors.some(text=>/couldn't submit your application/i.test(text)&&/applied for a position in this domain within the last 90 days/i.test(text)&&/cannot submit an application for this position/i.test(text));
 if(policyDenied)return {status:'SKIPPED',confirmation_id:null,confirmation_evidence:'ATS_EXPLICIT_REAPPLICATION_DENIAL',skip_reason:'EMPLOYER_90_DAY_DOMAIN_LIMIT',screenshot_path:result.screenshot_path,validation_errors:errors};
 const confirmed=result?.status==='SUBMITTED' && typeof result.confirmation_id==='string'
  && result.confirmation_id.trim().length>0 && (result.confirmation_evidence==='NETWORK_AND_PAGE'||result.confirmation_evidence==='ATS_SUCCESS_PAGE_AND_SCREENSHOT'&&typeof result.screenshot_path==='string'&&/^(?:ashby|lever)-success:/.test(result.confirmation_id));
 return {
  status:confirmed?'SUBMITTED':'SUBMISSION_UNKNOWN',
  confirmation_id:confirmed?result.confirmation_id:null,
  confirmation_evidence:result?.confirmation_evidence??null,
  ...(result?.screenshot_path?{screenshot_path:result.screenshot_path}:{}),
  ...(Array.isArray(result?.validation_errors)?{validation_errors:result.validation_errors}:{}),
 };
}
