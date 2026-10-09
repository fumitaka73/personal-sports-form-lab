import {POSE_SCHEMA,POSE_STRIDE,POSE_BUDGET} from './pose-archive.js';
export function exportPoseTrace(session,chunks){const header=new TextEncoder().encode(JSON.stringify({schema:POSE_SCHEMA,session,chunks:chunks.map(c=>({index:c.index,bytes:c.buffer.byteLength}))}));const length=new Uint32Array([header.length]);return new Blob([length.buffer,header,...chunks.map(c=>c.buffer)],{type:'application/octet-stream'});}
export async function readPoseTrace(file){
 if(file.size>POSE_BUDGET+262148||file.size<4)throw new Error('姿勢ファイルのサイズが不正です');
 const size=new DataView(await file.slice(0,4).arrayBuffer()).getUint32(0,true);if(size>262144||size+4>file.size)throw new Error('姿勢ファイルのヘッダが不正です');
 const header=JSON.parse(await file.slice(4,4+size).text()),s=header.session;
 if(header.schema!==POSE_SCHEMA||!s||typeof s.complete!=='boolean'||!['recording','complete','incomplete'].includes(s.status)||typeof s.id!=='string'||s.id.length>200||!Number.isFinite(s.origin)||!Number.isFinite(s.end)||s.origin>s.end||!Number.isFinite(s.createdAt)||!['jump','set','free'].includes(s.metadata?.shotType)||!['front','side','diagonal'].includes(s.metadata?.cameraAngle)||!['right','left'].includes(s.metadata?.hand)||typeof s.goodFormId!=='string'||!Number.isInteger(s.count)||s.count<1||!Array.isArray(header.chunks)||!header.chunks.length||header.chunks.length>4000)throw new Error('姿勢ファイルの構造が不正です');
 let offset=4+size,count=0,previous=-Infinity;const chunks=[];
 for(const [index,c]of header.chunks.entries()){if(c.index!==index||!Number.isInteger(c.bytes)||c.bytes<=0||c.bytes%(POSE_STRIDE*4)||c.bytes>1000*POSE_STRIDE*4||offset+c.bytes>file.size)throw new Error('姿勢チャンクが不正です');const buffer=await file.slice(offset,offset+c.bytes).arrayBuffer(),values=new Float32Array(buffer);offset+=c.bytes;
  for(let i=0;i<values.length;i+=POSE_STRIDE){if(!Number.isFinite(values[i])||values[i]<0||values[i]<=previous||s.origin+values[i]>s.end+.01||!Number.isFinite(values[i+1])||values[i+1]<=0||values[i+1]>10||![0,1].includes(values[i+2]))throw new Error('姿勢時刻が不正です');previous=values[i];for(let j=i+3;j<i+POSE_STRIDE;j++)if(!Number.isFinite(values[j])||Math.abs(values[j])>100)throw new Error('関節値が不正です');count++;}
  chunks.push({id:`${s.id}:${String(index).padStart(6,'0')}`,sessionId:s.id,index,buffer});
 }
 if(offset!==file.size||count!==s.count||chunks.reduce((n,c)=>n+c.buffer.byteLength,0)!==s.bytes)throw new Error('姿勢ファイルが不完全です');
 return {session:{...s,schema:POSE_SCHEMA,chunks:chunks.length,imported:true},chunks};
}
