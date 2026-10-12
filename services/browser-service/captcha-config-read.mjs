// Loading provider configuration/challenge material is distinct from answering
// a challenge. checkcaptcha/userverify remain limited to a human interaction.
export function reviewedCaptchaConfigRead({url,method,body,pageUrl,siteKeys=new Set()}){
 let target,page;try{target=new URL(url);page=new URL(pageUrl);}catch{return false;}
 if(method!=='POST'||page.origin!=='https://jobs.lever.co'||target.protocol!=='https:'||!['api.hcaptcha.com','api2.hcaptcha.com','hcaptcha.com'].includes(target.hostname))return false;
 const config=target.pathname==='/checksiteconfig',challenge=/^\/getcaptcha\/[a-zA-Z0-9_-]{1,100}$/.test(target.pathname);
 if(!config&&!challenge||!Buffer.isBuffer(body)||body.length>64000)return false;
 let data;try{data=body.length?Object.fromEntries(new URLSearchParams(body.toString('utf8'))):{};}catch{return false;}
 const params={...Object.fromEntries(target.searchParams),...data};
 if(Object.keys(params).some(k=>/answer|response|passcode|password|email|phone/i.test(k)))return false;
 if(challenge)return (params.host===page.hostname||!params.host)&&siteKeys.has(target.pathname.split('/')[2]);
 if(params.host!==page.hostname)return false;
 const allowed=config?['v','host','sitekey','sc','swa','spst','se','r']:['v','host','sitekey','hl','motionData','n','c','pst','rqdata','r','action','extraData'];
 return Object.keys(params).every(k=>allowed.includes(k))&&(config?/^[a-zA-Z0-9_-]{1,100}$/.test(params.sitekey??''):true);
}
