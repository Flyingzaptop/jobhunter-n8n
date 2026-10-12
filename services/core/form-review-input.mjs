// Remove serialization/receipt metadata, not employer answers or CV content.
export function compactFormReviewInput(input){
 const document=input.cv??{};
 const textClaim=c=>typeof c==='string'?c:c&&{text:c.text,source_fact_ids:c.source_fact_ids};
 const cv={...document};delete cv.source_map;delete cv.render_metadata;
 if(cv.headline)cv.headline=textClaim(cv.headline);
 for(const key of ['summary','skills','application_text'])if(Array.isArray(cv[key]))cv[key]=cv[key].map(textClaim);
 const groups=new Map(),answers=[];
 for(const a of input.answers){
  if(a.type!=='radio'){answers.push({...a,value:a.type==='checkbox'?Boolean(a.checked):a.value});continue;}
  const key=JSON.stringify([a.step,a.name||a.group_label||a.question]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);
 }
 for(const options of groups.values()){
  const selected=options.find(a=>a.checked),anchor=selected??options[0];
  answers.push({...anchor,question:anchor.group_label||anchor.question,type:'radio-group',value:selected?.question??null,checked:Boolean(selected),required:options.some(a=>a.required),options:options.map(a=>a.question)});
 }
 return {...input,cv,
  accepted_human_answers:(input.accepted_human_answers??[]).map(a=>({label:a.label,type:a.type,value:a.value,checked:a.checked,question_type:a.question_type,source:a.source??'USER_CONFIRMED'})),
  // Earlier steps are already present as historical entries in answers.
  previous_steps:undefined,
  upload:(input.upload??[]).map(u=>({filename:u.filename,sha256:u.sha256,evidence:u.evidence})),
  answers:answers.map(a=>({...a,group_label:a.group_label===a.question?undefined:a.group_label,name:undefined}))};
}
