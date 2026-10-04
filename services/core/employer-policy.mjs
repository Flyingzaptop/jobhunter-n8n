const aiBan=/\b(?:AI|artificial intelligence|generated content)\b[^.\n]{0,100}(?:disqualif|not permitted|prohibit)|(?:prohibit|not allowed|must not|do not)[^.\n]{0,180}\b(?:AI|artificial intelligence)\b|only my own words/i;
const applicationScope=/application process|(?:application|written) (?:answers|responses)|only my own words|(?:AI|artificial intelligence|generated content)[^.\n]{0,100}(?:resume|curriculum vitae|\bcv\b|cover letter)|(?:resume|curriculum vitae|\bcv\b|cover letter)[^.\n]{0,100}(?:AI|artificial intelligence|generated content)/i;
export function employerAutomationPolicy(view){
 const labels=(view.fields??[]).map(f=>f.label??'');
 const paragraphs=String(view.text??'').split(/\n\s*\n/);
 for(const text of [...labels,...paragraphs]){
  if(!aiBan.test(text))continue;
  if(/interview|live coding|coding assessment/i.test(text)&&!applicationScope.test(text))continue;
  return 'HUMAN_AUTHORED_ONLY';
 }
 return null;
}
