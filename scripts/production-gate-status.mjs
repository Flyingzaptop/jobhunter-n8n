import {readFile,mkdir,writeFile} from 'node:fs/promises';
import YAML from 'yaml';
import {Repository} from '../services/core/repository.mjs';
import {productionGateStatus} from '../services/core/production-gate.mjs';
const repository=new Repository();try{
 const profile=YAML.parse(await readFile('config/candidate_profile.yaml','utf8'));
 const report=await productionGateStatus({repository,profile});await mkdir('tests/results',{recursive:true});await writeFile('tests/results/production-gate-status.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await repository.close();}
