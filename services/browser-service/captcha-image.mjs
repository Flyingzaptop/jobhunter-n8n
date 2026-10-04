// Read-only capture for a human handoff. No challenge interaction or code read.
export async function captureCaptchaImage(page) {
 const candidates=page.locator('iframe[src*="captcha"],.g-recaptcha,.h-captcha,[data-captcha]');
 const masks=page.frames().map(frame=>frame.locator('input,textarea,select'));
 for(let i=0;i<await candidates.count();i++){
  const target=candidates.nth(i);
  if(!await target.isVisible())continue;
  const bounds=await target.boundingBox();
  if(!bounds||bounds.width<20||bounds.height<20||bounds.width>1000||bounds.height>800||bounds.width*bounds.height>600000)continue;
  if(!await target.evaluate(e=>!['HTML','BODY'].includes(e.tagName)))continue;
  const png=await target.screenshot({mask:masks,maskColor:'#18212a',timeout:5000});
  if(png.length>2*1024*1024)throw new Error('CAPTCHA_CAPTURE_TOO_LARGE');
  return {png_base64:png.toString('base64'),scope:'CAPTCHA_ELEMENT_CROP',redacted:true,persisted:false,captured_at:new Date().toISOString()};
 }
 throw new Error('VISIBLE_CAPTCHA_REGION_UNAVAILABLE');
}
