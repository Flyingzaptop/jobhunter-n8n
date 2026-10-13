import test from 'node:test';import assert from 'node:assert/strict';import {gzipSync,brotliCompressSync,deflateSync} from 'node:zlib';import {decodedNetworkResponse} from '../services/browser-service/decoded-network-response.mjs';
test('CDP response normalization preserves exact bytes and removes stale compression headers',()=>{
 const bytes=Buffer.from([0,255,128,13,10]);for(const [encoding,compress]of [['gzip',gzipSync],['br',brotliCompressSync],['deflate',deflateSync]]){const result=decodedNetworkResponse({'content-encoding':encoding,'content-type':'application/octet-stream'},compress(bytes));assert.deepEqual(result.body,bytes);assert.equal(result.headers['content-encoding'],undefined);assert.equal(result.headers['content-length'],'5');}
 assert.throws(()=>decodedNetworkResponse({'content-encoding':'gzip'},gzipSync(Buffer.alloc(1000)),{maxBytes:10}));
});
