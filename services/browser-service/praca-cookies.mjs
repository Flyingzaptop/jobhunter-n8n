export async function dismissPracaCookies(page){
 if(new URL(page.url()).hostname!=='www.praca.pl')return {status:'NOT_APPLICABLE'};
 const popup=page.locator('#lPopups');
 if(!await popup.count())return {status:'NOT_PRESENT'};
 if(!/plik[\p{L}]*\s+cookies/iu.test(await popup.innerText()))return {status:'NOT_COOKIE_OVERLAY'};
 const reject=popup.getByText(/^odrzuć wszystkie$/i,{exact:true}).first();
 if(!await reject.isVisible().catch(()=>false)){
  const customize=popup.getByText(/^akceptuj wybrane$/i,{exact:true}).first();
  if(!await customize.isVisible().catch(()=>false))return {status:'NO_REVIEWED_COOKIE_ACTION'};
  await customize.click();await reject.waitFor({state:'visible',timeout:3000});
 }
 await reject.click();
 await reject.waitFor({state:'hidden',timeout:3000});
 return {status:'DISMISSED',optional_cookies:false};
}
export async function dismissPracaUploadError(page){
 const url=new URL(page.url());if(url.hostname!=='www.praca.pl'||!/^\/apply\/internal\/\d+\.html$/.test(url.pathname))return false;
 const popup=page.locator('#lPopups');if(!await popup.count()||!(await popup.innerText()).includes('Failed to fetch'))return false;
 const acknowledgement=popup.getByText(/^ok$/i,{exact:true}).first();
 if(!await acknowledgement.isVisible().catch(()=>false))return false;
 await acknowledgement.click();return true;
}
