export function confirmedSubmissionResult(result) {
 const confirmed=result?.status==='SUBMITTED' && typeof result.confirmation_id==='string'
  && result.confirmation_id.trim().length>0 && result.confirmation_evidence==='NETWORK_AND_PAGE';
 return {
  status:confirmed?'SUBMITTED':'SUBMISSION_UNKNOWN',
  confirmation_id:confirmed?result.confirmation_id:null,
  confirmation_evidence:result?.confirmation_evidence??null,
  ...(result?.screenshot_path?{screenshot_path:result.screenshot_path}:{}),
  ...(Array.isArray(result?.validation_errors)?{validation_errors:result.validation_errors}:{}),
 };
}
