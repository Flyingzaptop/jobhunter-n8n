import {gunzipSync,brotliDecompressSync,inflateSync} from 'node:zlib';
export function decodedNetworkResponse(headers,bytes,{maxBytes=20*1024*1024}={}){
 const result={...headers};let body=bytes;
 const encoding=String(result['content-encoding']??'').trim().toLowerCase();
 const options={maxOutputLength:maxBytes};
 if(encoding==='gzip')body=gunzipSync(bytes,options);
 else if(encoding==='br')body=brotliDecompressSync(bytes,options);
 else if(encoding==='deflate')body=inflateSync(bytes,options);
 else if(encoding&&encoding!=='identity')throw Error('UNSUPPORTED_RESPONSE_ENCODING');
 if(body.length>maxBytes)throw Error('DECODED_RESPONSE_TOO_LARGE');
 delete result['content-encoding'];result['content-length']=String(body.length);
 return {headers:result,body};
}
