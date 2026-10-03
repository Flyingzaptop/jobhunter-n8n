import path from 'node:path';
import { readdir,stat,unlink } from 'node:fs/promises';

export async function pruneBrowserState({root,sessionHours=48,screenshotHours=168,activeSessionIds=new Set(),now=Date.now()}) {
  if(!Number.isFinite(sessionHours)||sessionHours<0||!Number.isFinite(screenshotHours)||screenshotHours<0)throw new Error('INVALID_BROWSER_RETENTION');
  const removed={sessions:0,screenshots:0};
  for(const filename of await readdir(root)){
    const session=/^([0-9a-f-]{36})\.json$/.exec(filename),image=/^([0-9a-f-]{36})-\d+\.png$/.exec(filename);
    if(!session&&!image)continue;
    const id=(session||image)[1];if(activeSessionIds.has(id))continue;
    const hours=session?sessionHours:screenshotHours;if(hours===0)continue;
    const target=path.join(root,filename),info=await stat(target);if(!info.isFile()||now-info.mtimeMs<hours*3600000)continue;
    await unlink(target);removed[session?'sessions':'screenshots']++;
  }
  return removed;
}
