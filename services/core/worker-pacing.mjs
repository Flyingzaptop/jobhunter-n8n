export function lanePollDelay(lane,state,intervalMs=60000){
 if(state==='PAUSED')return Math.max(intervalMs,30000);
 if(['RETRY','WAITING','WAITING_REVIEW','EMPTY_QUEUE','CHECKING'].includes(state))return Math.max(intervalMs,30000);
 if(lane==='model')return 250;
 return Math.min(intervalMs,lane==='notifications'?10000:5000);
}
export function preparationWorkKey(profile,row,policy,template,digest){return 'prepare:'+digest([profile.profile_id,row.job_id,digest(profile),digest(policy),template,row.cv_id]);}

// Many lanes need the same expensive market snapshot. Share both the in-flight
// query and its result; only work claims are per-lane and transactional.
export class SharedSnapshot {
 constructor(ttlMs=30000){this.ttlMs=ttlMs;this.entries=new Map();}
 get(key,load){const old=this.entries.get(key);if(old&&(old.pending||Date.now()-old.at<this.ttlMs))return old.promise;
  const entry={at:0,pending:true};entry.promise=Promise.resolve().then(load).then(value=>{entry.pending=false;entry.at=Date.now();return value;}).catch(error=>{if(this.entries.get(key)===entry)this.entries.delete(key);throw error;});
  this.entries.clear();this.entries.set(key,entry);return entry.promise;
 }
}
