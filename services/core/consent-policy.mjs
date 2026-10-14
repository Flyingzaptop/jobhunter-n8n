export function standingRecruitmentConsent(field,policy={}){
 if(policy.consent_policy?.current_recruitment_data_processing!==true||field.type!=='checkbox')return false;
 const text=`${field.label??''} ${field.description??''}`;
 if(/marketing|newsletter|talent community|future\b.{0,40}\b(?:job|opportunit|position|recruit|vacanc)|przysz[lł].*rekrut|profiling|medical|criminal|background check|travel|relocat|coordination hours|available for meetings/i.test(text))return false;
 return /rodo|gdpr|privacy notice|privacy policy|data protection|personal data|processing.*data|data.*processing|przetwarzani.*danych|ochron.*danych/i.test(text);
}
export function standingRecruitmentSelectAnswer(field,policy={}){
 if(!field.options||!standingRecruitmentConsent({...field,type:'checkbox'},policy))return null;
 const options=field.options.filter(o=>/^(?:i agree|yes|tak|wyrazam zgode)$/i.test(String(o.label).trim()));
 return options.length===1?{value:options[0].value,source:'STANDING_RECRUITMENT_CONSENT'}:null;
}
