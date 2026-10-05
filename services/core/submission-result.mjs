export function confirmedSubmissionResult(result) {
 const confirmed=result?.status==='SUBMITTED' && typeof result.confirmation_id==='string'
  && result.confirmation_id.trim().length>0 && (result.confirmation_evidence==='NETWORK_AND_PAGE'||result.confirmation_evidence==='ATS_SUCCESS_PAGE_AND_SCREENSHOT'&&typeof result.screenshot_path==='string'&&result.confirmation_id.startsWith('ashby-success:'));
 return {
  status:confirmed?'SUBMITTED':'SUBMISSION_UNKNOWN',
  confirmation_id:confirmed?result.confirmation_id:null,
  confirmation_evidence:result?.confirmation_evidence??null,
  ...(result?.screenshot_path?{screenshot_path:result.screenshot_path}:{}),
  ...(Array.isArray(result?.validation_errors)?{validation_errors:result.validation_errors}:{}),
 };
}
