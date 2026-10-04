// Losslessly factor repeated schema nodes in the prompt. The transport and
// validation still receive the original schema; no candidate/source data changes.
export function compactPromptSchema(schema){
 const counts=new Map(),definitions={},names=new Map();
 const direct=['items','additionalProperties','additionalItems','propertyNames','contains','not','if','then','else'];
 const maps=['properties','patternProperties','$defs','definitions'];
 function children(node,visit){
  for(const key of direct)if(node[key]&&typeof node[key]==='object'&&!Array.isArray(node[key]))visit(node[key]);
  for(const key of maps)for(const child of Object.values(node[key]??{}))if(child&&typeof child==='object')visit(child);
  for(const key of ['anyOf','allOf','oneOf'])for(const child of node[key]??[])if(child&&typeof child==='object')visit(child);
 }
 function count(node){const signature=JSON.stringify(node);counts.set(signature,(counts.get(signature)??0)+1);children(node,count);}
 count(schema);
 function transform(node,skip){
  if(!node||typeof node!=='object'||Array.isArray(node))return structuredClone(node);
  const signature=JSON.stringify(node);
  if(signature!==skip&&signature.length>=240&&(counts.get(signature)??0)>1){
   let name=names.get(signature);
   if(!name){let number=names.size;do{name='jobhunter_shared_'+number++;}while(Object.hasOwn(schema.$defs??{},name)||[...names.values()].includes(name));names.set(signature,name);definitions[name]=transform(node,signature);}
   return {$ref:'#/$defs/'+name};
  }
  const result=structuredClone(node);
  for(const key of direct)if(node[key]&&typeof node[key]==='object'&&!Array.isArray(node[key]))result[key]=transform(node[key]);
  for(const key of maps)if(node[key])result[key]=Object.fromEntries(Object.entries(node[key]).map(([name,child])=>[name,typeof child==='object'?transform(child):child]));
  for(const key of ['anyOf','allOf','oneOf'])if(node[key])result[key]=node[key].map(child=>typeof child==='object'?transform(child):child);
  return result;
 }
 const result=transform(schema,JSON.stringify(schema));
 if(names.size)result.$defs={...result.$defs,...definitions};
 return result;
}
