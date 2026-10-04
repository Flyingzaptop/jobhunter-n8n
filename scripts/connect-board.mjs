import {openBoardProfile,BOARD_PROFILES} from '../services/core/board-profiles.mjs';
const board=process.argv[2];
if(!Object.hasOwn(BOARD_PROFILES,board))throw new Error('Usage: node scripts/connect-board.mjs praca|olx|pracuj|linkedin');
const context=await openBoardProfile(board,{headless:false,manual:true});
console.log(JSON.stringify({event:'BOARD_MANUAL_LOGIN_WINDOW',board,instruction:'Sign in manually, then close this browser window. Credentials remain in the local browser profile.'}));
await new Promise(resolve=>context.once('close',resolve));
await new Promise(resolve=>setTimeout(resolve,300));
console.log(JSON.stringify({event:'BOARD_PROFILE_SAVED',board,authentication_verified:false}));
