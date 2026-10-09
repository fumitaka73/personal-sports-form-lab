import {POSE_STRIDE} from './pose-archive.js';
export function poseIntegrity(session,chunks){
 const bytes=chunks.reduce((n,c)=>n+(c.buffer?.byteLength??0),0),count=bytes/(POSE_STRIDE*4);
 const error=!chunks.length?'保存チャンクなし':chunks.some((c,i)=>c.sessionId!==session.id||c.index!==i||!(c.buffer instanceof ArrayBuffer)||c.buffer.byteLength%(POSE_STRIDE*4))?'ID・順番・チャンク形式が不一致':session.count!==count||session.bytes!==bytes||session.chunks!==chunks.length?'保存量・フレーム数が記録と不一致':null;
 return {bytes,count,chunks:chunks.length,error};
}
