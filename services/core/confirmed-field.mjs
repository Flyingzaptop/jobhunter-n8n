export function confirmedFieldMatches(field,view,confirmed){
 return Boolean(confirmed&&field.selector&&confirmed.label===field.label&&confirmed.type===field.type
  &&confirmed.fingerprint===view.fingerprint&&confirmed.value===field.value&&confirmed.question_id);
}
