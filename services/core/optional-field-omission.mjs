export function approvedOptionalOmission(field,application,job){
 const receipt=application.last_state?.approved_optional_omissions?.[field.selector];
 return field.required===false&&receipt?.source==='USER_CHAT'&&receipt.application_id===application.application_id&&receipt.job_id===job.job_id&&receipt.field_name===field.name&&receipt.field_label===field.label;
}
