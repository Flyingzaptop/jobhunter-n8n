// WebIDL [PutForwards=value] compatibility for the standard iframe interface.
// Preserve the native getter and token list; never remove sandbox attributes.
export function installObscuraDomCompatibility(){
 const iframe=document.createElement('iframe');let owner=Object.getPrototypeOf(iframe),descriptor;
 while(owner){descriptor=Object.getOwnPropertyDescriptor(owner,'sandbox');if(descriptor)break;owner=Object.getPrototypeOf(owner);}
 if(!descriptor?.get||descriptor.set||descriptor.configurable===false)return;
 Object.defineProperty(owner,'sandbox',{...descriptor,set(value){
  const tokens=descriptor.get.call(this);tokens.value=String(value);
 }});
}
