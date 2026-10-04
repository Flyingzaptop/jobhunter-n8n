import {Repository} from '../services/core/repository.mjs';
const r=new Repository();try{
 const id=process.argv[2];if(!/^[a-f0-9-]{36}$/i.test(id??''))throw new Error('Job UUID required');
 const analysis=(await r.pool.query('SELECT analysis_json FROM job_analysis WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0]?.analysis_json;
 console.log(JSON.stringify({decision:analysis?.decision,overall_fit:analysis?.overall_fit,hard_blockers:analysis?.hard_blockers,reasons:analysis?.reasons,work_format:analysis?.work_format,work_format_class:analysis?.work_format_class,work_format_evidence:analysis?.work_format_evidence,employment_eligibility:analysis?.employment_eligibility,remote_hiring:analysis?.remote_hiring,requirements:analysis?.requirements?.map(q=>({source_quote:q.source_quote,match:q.match,category:q.category,importance:q.importance,candidate_evidence_fact_ids:q.candidate_evidence_fact_ids,reason:q.reason}))},null,2));
}finally{await r.close();}
