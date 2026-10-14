// Remove serialization/receipt metadata, not employer answers or CV content.
export function historicalFormAnswers(answers,currentStep){return (answers??[]).filter(answer=>Number.isInteger(answer.step)&&answer.step>=0&&answer.step!==currentStep);}
export function compactFormReviewInput(input){
 const document=input.cv??{};
 const textClaim=c=>typeof c==='string'?c:c&&{text:c.text,source_fact_ids:c.source_fact_ids};
 const cv={...document};delete cv.source_map;delete cv.render_metadata;
 if(cv.headline)cv.headline=textClaim(cv.headline);
 for(const key of ['summary','skills','application_text'])if(Array.isArray(cv[key]))cv[key]=cv[key].map(textClaim);
 const groups=new Map(),answers=[];
 for(const a of input.answers){
  if(a.type!=='radio'&&!a.selection_group){answers.push({...a,value:a.type==='checkbox'?Boolean(a.checked):a.value});continue;}
  const key=JSON.stringify([a.step,a.form_id,a.form,a.type,a.selection_group||a.name||a.group_label||a.question]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);
 }
 for(const options of groups.values()){
  const selected=options.find(a=>a.checked),anchor=selected??options[0];
  const multiple=Boolean(anchor.selection_group),chosen=options.filter(a=>a.checked).map(a=>a.question);
  answers.push({...anchor,question:anchor.group_label||anchor.question,type:multiple?'checkbox-group':'radio-group',value:multiple?chosen:selected?.question??null,checked:Boolean(selected),required:options.some(a=>a.required),options:options.map(a=>a.question),...(multiple?{expected_answer:options.some(a=>a.expected_answer===true)?options.filter(a=>a.expected_answer===true).map(a=>a.question):undefined}:{})});
 }
 return {...input,cv,
  accepted_human_answers:(input.accepted_human_answers??[]).map(a=>({label:a.label??a.question,type:a.type,value:a.value??a.answer,checked:a.checked,omit:a.omit,question_type:a.question_type,source:a.source??'USER_CONFIRMED'})),
  // Earlier steps are already present as historical entries in answers.
  previous_steps:undefined,
  upload:(input.upload??[]).map(u=>({filename:u.filename,sha256:u.sha256,evidence:u.evidence})),
  answers:answers.map(a=>({...a,group_label:a.group_label===a.question?undefined:a.group_label,name:undefined}))};
}
