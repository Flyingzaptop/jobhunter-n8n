const norm=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
export function choicePeers(field,fields){
 return field.selection_group?fields.filter(f=>f.type==='checkbox'&&f.selection_group===field.selection_group&&f.form===field.form&&f.form_id===field.form_id&&f.visible&&!f.disabled):[];
}
export function choiceGroupQuestion(field,fields){
 const peers=choicePeers(field,fields);
 return peers.length?`${field.group_label}\nOptions: ${peers.map(f=>f.label||f.value).join(' / ')}`:field.label;
}
export function choiceGroupTarget(field,fields,answer){
 const peers=choicePeers(field,fields);let text=norm(answer);
 const exact=peers.filter(f=>norm(f.value)===text||norm(f.label)===text);
 if(exact.length===1)return exact[0];
 if(peers.length===2&&peers.some(f=>norm(f.value)==='yes')&&peers.some(f=>norm(f.value)==='no')){
  if(/^(да|tak|true)$/.test(text))text='yes';else if(/^(нет|nie|false)$/.test(text))text='no';
  return peers.find(f=>norm(f.value)===text)??null;
 }
 return null;
}
