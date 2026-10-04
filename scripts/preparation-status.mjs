import {Repository} from '../services/core/repository.mjs';
const r=new Repository();try{
 const applications=(await r.pool.query('SELECT application_id,job_id,status,last_state FROM applications ORDER BY started_at DESC LIMIT 3')).rows;
 const failures=(await r.pool.query("SELECT entity_id,payload_json FROM events WHERE event_type='PREPARATION_EVIDENCE_REJECTED' ORDER BY created_at DESC LIMIT 3")).rows;
 console.log(JSON.stringify({applications:applications.map(a=>({application_id:a.application_id,job_id:a.job_id,status:a.status,preparation_only:a.last_state?.preparation_only})),failures}));
}finally{await r.close();}
