import {MIB,SAFETY_DEFAULTS} from './coach-safety.js';
// Keep a final segment and warning interval available before offering recording.
export const START_RESERVE={video:16*MIB,pose:180000};
export function practiceCapacity(videos,poses){
 const videoUsed=videos.reduce((n,v)=>n+(v.bytes??v.blob?.size??0),0),poseUsed=poses.reduce((n,p)=>n+(p.bytes??0),0);
 return {video:{used:videoUsed,remaining:Math.max(0,SAFETY_DEFAULTS.videoLimit-videoUsed),limit:SAFETY_DEFAULTS.videoLimit},pose:{used:poseUsed,remaining:Math.max(0,SAFETY_DEFAULTS.poseLimit-poseUsed),limit:SAFETY_DEFAULTS.poseLimit}};
}
export function practiceError(kind,error){
 const label=kind==='video'?'動画':kind==='pose'?'姿勢記録':'練習結果';
 if(error?.code==='budget')return `${label}の保存枠が少なく、最後の記録を安全に保存できる余裕がありません。既存データはそのまま残します。`;
 if(error?.code==='unsupported'||error?.name==='NotSupportedError')return 'このSafari・端末では動画録画を利用できません。動画なしでフォーム確認と音声は利用できます。';
 if(error?.name==='QuotaExceededError'||/空き容量不足/.test(error?.message??''))return `${label}の保存先の空き容量が不足しています。端末の空き容量を確認してください。Safariのサイトデータは消さないでください。`;
 if(['NotAllowedError','SecurityError'].includes(error?.name))return `${label}の保存・録画が許可されていません。Safariのサイト設定を確認してください。`;
 if(kind==='video'&&error?.code==='recorder')return '動画録画が中断されました。保存済みの動画区間は残ります。';
 return `${label}を保存・準備できませんでした。${error?.message??'保存機能が利用できません。'} 再試行するか、端末の空き容量を確認してください。`;
}
