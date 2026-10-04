import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

export const BOARD_PROFILES=Object.freeze({
 praca:{origin:'https://www.praca.pl',start:'https://www.praca.pl/'},
 olx:{origin:'https://www.olx.pl',start:'https://www.olx.pl/praca/'},
 pracuj:{origin:'https://www.pracuj.pl',start:'https://www.pracuj.pl/praca'},
 linkedin:{origin:'https://www.linkedin.com',start:'https://www.linkedin.com/login'},
});
export function boardProfilePath(board,root='data/board-profiles'){
 if(!Object.hasOwn(BOARD_PROFILES,board))throw new Error('UNKNOWN_BOARD_PROFILE');
 return path.resolve(root,board);
}
export function boardForUrl(value){try{const host=new URL(value).hostname;return Object.entries(BOARD_PROFILES).find(([,b])=>new URL(b.origin).hostname===host||host==='pl.linkedin.com'&&new URL(b.origin).hostname==='www.linkedin.com')?.[0]??null;}catch{return null;}}
export async function exportedBoardState(board){
 if(!board)return undefined;
 try{return JSON.parse(await readFile(path.join(boardProfilePath(board),'storage-state.json'),'utf8'));}catch{return undefined;}
}
export async function exportBoardState(context,board){
 const directory=boardProfilePath(board);await mkdir(directory,{recursive:true});
 await writeFile(path.join(directory,'storage-state.json'),JSON.stringify(await context.storageState()),{encoding:'utf8',mode:0o600});
}
export async function boardProfileStatus(board,{root}={}){
 const directory=boardProfilePath(board,root);
 try{const meta=JSON.parse(await readFile(path.join(directory,'profile.json'),'utf8'));
  let live=false;try{if(Number.isInteger(meta.owner_pid)){process.kill(meta.owner_pid,0);live=true;}}catch{}
  return {board,prepared:meta.prepared===true,headless:meta.headless!==false,updated_at:meta.updated_at,manual_login_active:meta.manual_login_active===true&&live,authentication_verified:false};
 }catch{return {board,prepared:false,authentication_verified:false};}
}
export async function openBoardProfile(board,{root,headless=true,channel='chrome',manual=false}={}){
 const directory=boardProfilePath(board,root);await mkdir(directory,{recursive:true});
 const context=await chromium.launchPersistentContext(path.join(directory,'chromium'),{
  headless,channel,acceptDownloads:false,args:['--disable-gpu'],
 });
 if(manual){
  const earlier=await boardProfileStatus(board,{root});
  await writeFile(path.join(directory,'profile.json'),JSON.stringify({...earlier,manual_login_active:true,owner_pid:process.pid,updated_at:new Date().toISOString()}),{encoding:'utf8',mode:0o600});
  const page=context.pages()[0]??await context.newPage();
  await page.goto(BOARD_PROFILES[board].start,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
  context.once('close',()=>writeFile(path.join(directory,'profile.json'),JSON.stringify({
   prepared:true,headless:board!=='pracuj',updated_at:new Date().toISOString(),
   provenance:'USER_MANAGED_BROWSER_PROFILE',authentication_verified:false,
  }),{encoding:'utf8',mode:0o600}).catch(()=>{}));
 }
 return context;
}
