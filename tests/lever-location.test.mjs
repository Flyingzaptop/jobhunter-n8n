import test from 'node:test';import assert from 'node:assert/strict';import {matchingLeverLocation} from '../services/browser-service/lever-location.mjs';
test('location selection handles Polish spelling and refuses another country or ambiguous choice',()=>{
 assert.equal(matchingLeverLocation(['Wrocław, Dolnośląskie, Poland','Warsaw, Poland'],'Wroclaw, Poland').index,0);
 assert.throws(()=>matchingLeverLocation(['Wroclaw, USA'],'Wroclaw, Poland'));
 assert.throws(()=>matchingLeverLocation(['Wroclaw, Poland','Wrocław, Poland'],'Wroclaw, Poland'));
});
