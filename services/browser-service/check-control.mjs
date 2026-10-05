import {randomUUID} from 'node:crypto';
export async function setCheckedControl(page,locator,checked){
 if(await locator.isChecked()===checked)return;
 if(await locator.isVisible()){await locator.setChecked(checked);return;}
 const marker=randomUUID();
 await locator.evaluate((input,marker)=>{for(const label of input.labels??[])label.setAttribute('data-jh-check-label',marker);},marker);
 const label=page.locator(`[data-jh-check-label="${marker}"]:visible`).first();
 if(!await label.count())throw new Error('CHECK_CONTROL_HAS_NO_VISIBLE_LABEL');
 await label.click();
 if(await locator.isChecked()!==checked)throw new Error('CHECK_CONTROL_NOT_CHANGED');
}
