import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {probeHeadlessBoards} from '../services/core/headless-public-boards.mjs';
export {BOARD_TARGETS,boardVacancyLinks,challengeState,probeHeadlessBoards,publicBrowserRequestAllowed} from '../services/core/headless-public-boards.mjs';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const names=process.argv.find(arg=>arg.startsWith('--sources='))?.slice(10).split(',');
  const maxDetails=Number(process.argv.find(arg=>arg.startsWith('--max-details='))?.slice(14)??2);
  const report=await probeHeadlessBoards({names,maxDetails});
  await mkdir('tests/results',{recursive:true});await writeFile('tests/results/headless-board-probe.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,sources:report.sources.map(({job_links,details,...source})=>({...source,details:details.map(({job_postings,...detail})=>detail)}))},null,2));
}
