export class SessionBudget {
 constructor({sessions,max=4,idleMs=120000,close,now=Date.now}) {
  if(!Number.isInteger(max)||max<1||max>16||!Number.isFinite(idleMs)||idleMs<1000)throw Error('INVALID_SESSION_BUDGET');
  Object.assign(this,{sessions,max,idleMs,close,now});this.reserved=0;
 }
 async reserve(){
  // Reserve synchronously before launching Chromium; concurrent creates cannot
  // all pass the limit while their contexts are still being constructed.
  if(this.sessions.size+this.reserved>=this.max)throw Error('BROWSER_CAPACITY_RETRY');
  this.reserved++;let released=false;return ()=>{if(!released){released=true;this.reserved--;}};
 }
 async sweep(){
  for(const session of this.sessions.values()){
   if(session.activeCalls||session.submitActive||session.leaseUntil>this.now()||session.closing)continue;
   if(this.now()-(session.lastUsedAt??this.now())<this.idleMs)continue;
   session.closing=true;try{await this.close(session);}finally{session.closing=false;}
  }
 }
}
