import {sha256} from '@noble/hashes/sha2.js';
import {md5} from '@noble/hashes/legacy.js';
import {bytesToHex} from '@noble/hashes/utils.js';
export function canonical(value){
 if(value===null||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(canonical);
 return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
}
export const jsonText=value=>JSON.stringify(canonical(value));
export const jsonBlob=value=>new Blob([jsonText(value)],{type:'application/json'});
export const hashText=text=>bytesToHex(sha256(new TextEncoder().encode(text)));
export const checkAbort=signal=>{if(signal?.aborted)throw new DOMException('中断','AbortError');};
// Standard hashes, bounded memory; no whole-video arrayBuffer on iPhone.
export async function hashBlob(blob,{signal,onProgress=()=>{}}={}){
 const a=sha256.create(),b=md5.create(),chunk=1024*1024;
 for(let offset=0;offset<blob.size;offset+=chunk){checkAbort(signal);const data=new Uint8Array(await blob.slice(offset,offset+chunk).arrayBuffer());a.update(data);b.update(data);onProgress(Math.min(offset+chunk,blob.size),blob.size);await new Promise(resolve=>setTimeout(resolve,0));}
 checkAbort(signal);return {sha256:bytesToHex(a.digest()),md5:bytesToHex(b.digest()),bytes:blob.size};
}
