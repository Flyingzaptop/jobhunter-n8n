export function safeDashboardReturnTo(value){
 return typeof value==='string'&&/^\/manual-captcha\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)?value:null;
}
