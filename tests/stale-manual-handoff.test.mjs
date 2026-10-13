import test from 'node:test';import assert from 'node:assert/strict';import {retireSupersededManualHandoffs} from '../services/core/stale-manual-handoff.mjs';
test('superseded manual question is closed, never fabricated as a human answer',async()=>{
 const queries=[];const client={release(){},async query(sql){queries.push(sql);if(sql.startsWith('SELECT status'))return {rows:[{status:'FILLING',last_state:{browser_session_id:'new'}}]};if(sql.startsWith('SELECT 1'))return {rowCount:0};if(sql.startsWith('UPDATE captcha_handoffs'))return {rows:[{handoff_id:'old',question_id:'question'}]};return {rows:[]};}};
 const count=await retireSupersededManualHandoffs({pool:{connect:async()=>client}},'application','new');
 assert.equal(count,1);assert.ok(queries.some(q=>q.includes('closed_at=now()')));assert.ok(!queries.some(q=>q.includes('SET answered_at')));assert.ok(queries.some(q=>q.includes('revoked_at=now()')));
});
