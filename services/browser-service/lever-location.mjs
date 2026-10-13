const normalize=v=>String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').toLowerCase();
export function matchingLeverLocation(labels,value){
 const [city,...rest]=normalize(value).split(',').map(v=>v.trim());const country=rest.at(-1);
 const matches=labels.map((label,index)=>({label,index})).filter(x=>{const normalized=normalize(x.label);return normalized.split(',')[0].trim()===city&&(!country||normalized.split(',').at(-1).trim()===country);});
 if(matches.length!==1)throw Error('AMBIGUOUS_LEVER_LOCATION');return matches[0];
}
export async function chooseLeverLocation(page,locator,value){
 // Lever searches on keyboard events, and clears unselected text on blur.
 await locator.fill('');await locator.pressSequentially(value,{delay:15});
 const options=page.locator('.dropdown-location');await options.first().waitFor({state:'visible',timeout:12000});
 const selected=matchingLeverLocation(await options.allTextContents(),value);
 await options.nth(selected.index).click();
 const input=await locator.inputValue();const stored=await page.locator('#selected-location').inputValue();
 if(input!==selected.label||JSON.parse(stored).name!==selected.label)throw Error('LEVER_LOCATION_NOT_SAVED');
}
