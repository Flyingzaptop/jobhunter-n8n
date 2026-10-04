export function pracujNextButton(page){
 return page.locator('[data-test="bottom-pagination-button-next"]:visible').first();
}
export async function dismissPracujReadOverlays(page){
 for(let attempt=0;attempt<6;attempt++){
 const customize=page.locator('[data-test="button-customizeCookie"]');
 if(await customize.isVisible().catch(()=>false)){
  await customize.click();
  const preferences=page.locator('dialog[open]').filter({has:page.locator('[data-test="button-submit"]')});
  await preferences.waitFor({state:'visible',timeout:1500}).catch(()=>{});
  if(await preferences.count()){
   for(const checkbox of await preferences.locator('input[type="checkbox"]:not(:disabled)').all())await checkbox.setChecked(false);
   await preferences.locator('[data-test="button-submit"]').click();
  }
 }
 for(const test of ['button-close-terms-of-service-popup','button-close-employer-popup']){
  const button=page.locator(`[data-test="${test}"]`);
  if(await button.isVisible().catch(()=>false))await button.click({timeout:1000}).catch(()=>{});
 }
 if(!await page.locator('dialog[open]').count())return;
 await page.waitForTimeout(500);
 }
}
