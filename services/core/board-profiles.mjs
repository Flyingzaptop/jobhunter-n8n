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
export async function boardProfileStatus(board,{root}={}){
 const directory=boardProfilePath(board,root);
 try{const meta=JSON.parse(await readFile(path.join(directory,'profile.json'),'utf8'));
  return {board,prepared:meta.prepared===true,headless:meta.headless!==false,updated_at:meta.updated_at,authentication_verified:false};
 }catch{return {board,prepared:false,authentication_verified:false};}
}
export async function openBoardProfile(board,{root,headless=true,channel='chrome',manual=false}={}){
 const directory=boardProfilePath(board,root);await mkdir(directory,{recursive:true});
 const context=await chromium.launchPersistentContext(path.join(directory,'chromium'),{
  headless,channel,acceptDownloads:false,args:['--disable-gpu'],
 });
 if(manual){
  const page=context.pages()[0]??await context.newPage();
  await page.goto(BOARD_PROFILES[board].start,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
  context.once('close',()=>writeFile(path.join(directory,'profile.json'),JSON.stringify({
   prepared:true,headless:board!=='pracuj',updated_at:new Date().toISOString(),
   provenance:'USER_MANAGED_BROWSER_PROFILE',authentication_verified:false,
  }),{encoding:'utf8',mode:0o600}).catch(()=>{}));
 }
 return context;
}
