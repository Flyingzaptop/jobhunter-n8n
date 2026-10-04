import {Repository} from '../services/core/repository.mjs';
const r=new Repository();try{
 const id=process.argv[2];if(!/^[a-f0-9-]{36}$/i.test(id??''))throw new Error('Job UUID required');
 const analysis=(await r.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0]?.analysis_json;
 console.log(JSON.stringify({decision:analysis?.decision,overall_fit:analysis?.overall_fit,hard_blockers:analysis?.hard_blockers,reasons:analysis?.reasons,requirements:analysis?.requirements?.map(q=>({source_quote:q.source_quote,candidate_match:q.candidate_match,category:q.category,importance:q.importance,candidate_evidence_fact_ids:q.candidate_evidence_fact_ids,gap:q.gap}))},null,2));
}finally{await r.close();}
