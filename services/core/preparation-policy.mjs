import {deterministicHardReject,workFormatAnalysis} from './fit.mjs';
import {compatibleCvTemplate} from './cv-v2.mjs';

export function currentPreparationPolicy({job,profile,policy={},analysis,cv,requireCurrentTemplate=true}){
 const applicantRegions=job.metadata?.validated_applicant_locations??[];if(applicantRegions.length&&!applicantRegions.some(r=>/^(?:poland|polska|pl|europe|european union|eu|eea|emea|worldwide|global|anywhere)$/i.test(String(r).trim())))return {pass:false,decision:'REJECT',reason:'APPLICANT_LOCATION_EXCLUDES_REQUIRED_BASE'};
 const hard=deterministicHardReject({job,profile,policy});
 if(hard)return {pass:false,decision:'REJECT',reason:hard.reasons[0],evidence:hard.hard_blockers};
 if(analysis?.decision==='REJECT')return {pass:false,decision:'REJECT',reason:'CURRENT_ANALYSIS_REJECTED'};
 const location=workFormatAnalysis({job,profile,policy,workFormat:analysis?.work_format});
 if(policy.work_location_policy?.required_base?.remain_physical&&location.location_policy_status!=='COMPATIBLE')
  return {pass:false,decision:location.location_policy_status==='INCOMPATIBLE'?'REJECT':'REVIEW',reason:'WORK_FROM_REQUIRED_BASE_NOT_VERIFIED',location_policy_status:location.location_policy_status};
 if(requireCurrentTemplate&&cv&&(!compatibleCvTemplate(cv.template_version)||cv.qa_json?.tailoring?.pass!==true))
  return {pass:false,decision:'REVIEW',reason:'CURRENT_TARGET_TAILORED_CV_REQUIRED'};
 return {pass:true,location_policy_status:location.location_policy_status};
}
