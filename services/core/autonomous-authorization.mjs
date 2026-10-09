import {readFile} from 'node:fs/promises';
export async function autonomousAuthorization(profile,{enabled=process.env.AUTONOMOUS_APPLICATIONS_ENABLED==='true',path='data/authorization/autonomous-applications.json'}={}){
 if(!enabled)throw Error('AUTONOMOUS_APPLICATIONS_DISABLED');
 const grant=JSON.parse(await readFile(path,'utf8'));
 if(grant.enabled!==true||grant.candidate_profile_id!==profile?.profile_id||grant.source!=='USER_CHAT'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(grant.authorization_id??'')||grant.submit_without_per_application_confirmation!==true)throw Error('AUTONOMOUS_USER_AUTHORIZATION_REQUIRED');
 return grant;
}
