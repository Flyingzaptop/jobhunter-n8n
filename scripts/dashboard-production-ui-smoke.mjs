import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3020',out=path.resolve('data/dashboard-v2/screenshots');
if(!process.env.DASHBOARD_PASSWORD)throw new Error('Ignored local dashboard password configuration required');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}});
const report={at:new Date().toISOString(),scope:'ACTUAL_PRODUCTION_GATE_READ_ONLY_UI',checks:[],screenshots:[],errors:[],real_employer_submissions:0};
let gateRequests=0,queueRequests=0;
page.on('request',r=>{if(r.url().endsWith('/api/production-gate'))gateRequests++;if(r.url().endsWith('/api/relevance-queue'))queueRequests++;});
page.on('pageerror',e=>report.errors.push(e.message));
try{
  await page.goto(base+'/#system');await page.getByLabel('Dashboard password',{exact:true}).fill(process.env.DASHBOARD_PASSWORD);await page.getByRole('button',{name:'Open control center'}).click();
  await page.locator('.production-evidence .gate-checks article').first().waitFor({timeout:20000});
  const get=async route=>{const r=await page.request.get(base+'/api'+route);assert.equal(r.status(),200);return(await r.json()).data;};
  const gate=await get('/production-gate'),queue=await get('/relevance-queue');
  assert.equal(await page.locator('.gate-checks article').count(),gate.checks.length);
  const rendered=await page.locator('.gate-check-heading .badge').allTextContents();
  for(let i=0;i<gate.checks.length;i++)assert.equal(rendered[i],gate.checks[i].pass?'PASS':'BLOCKED');
  assert.ok((await page.locator('.production-evidence').innerText()).includes('QUEUED / relevance score ≠ fit-qualified'));
  assert.ok((await page.locator('.model-invocations').innerText()).includes(String(queue.model_invocations)));
  assert.equal(await page.locator('.production-evidence table tbody tr').count(),queue.data.length);
  const first=queue.data[0];if(first)assert.ok((await page.locator('.production-evidence table tbody tr').first().innerText()).includes(first.title));
  report.checks.push({name:'Actual gate statuses and evidence match API',count:gate.checks.length,status:gate.status},{name:'Actual relevance rows/model invocation count match API',rows:queue.data.length,model_invocations:queue.model_invocations});
  for(const [label,selector]of[['21-production-gate','.production-evidence>.panel:first-child'],['22-relevance-queue','.production-evidence>.panel:nth-child(2)']]){const file=path.join(out,label+'.png');await page.locator(selector).screenshot({path:file});report.screenshots.push(path.relative(process.cwd(),file).replaceAll('\\','/'));}
  const before={gate:gateRequests,queue:queueRequests};await page.waitForTimeout(5700);assert.ok(gateRequests>before.gate);assert.ok(queueRequests>before.queue);report.checks.push({name:'Active view refreshes persisted data within five seconds'});
  await page.locator('.sidebar nav').getByRole('button',{name:'Jobs',exact:true}).click();await page.waitForTimeout(700);
  const after={gate:gateRequests,queue:queueRequests};await page.waitForTimeout(5600);assert.equal(gateRequests,after.gate);assert.equal(queueRequests,after.queue);report.checks.push({name:'Production/relevance polling stops on navigation'});
  assert.deepEqual(report.errors,[]);report.status='PASS';
  await page.getByRole('button',{name:'Sign out ↗',exact:true}).click();
}catch(error){report.status='FAILED';report.error=error.message;throw error;}
finally{await writeFile(path.resolve('data/dashboard-v2/production-ui-smoke.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
