// These are application budgets / observed estimates, never device memory measurements.
export const MIB=1048576;
export const SAFETY_DEFAULTS={videoLimit:128*MIB,poseLimit:32*MIB,maxSeconds:3600,warningDelay:5,segmentSeconds:15,reportReserve:8*MIB,slowSeconds:15,stallSeconds:15};
export const safetyMessages={
 video:{ja:'動画の容量が少なくなっています。まもなく練習を終了します',en:'Video space is running low. Practice will end shortly.'},
 pose:{ja:'姿勢記録の容量が少なくなっています。まもなく練習を終了します',en:'Pose storage is running low. Practice will end shortly.'},
 time:{ja:'姿勢分析の時間制限が近づいています。まもなく練習を終了します',en:'The pose recording time limit is near. Practice will end shortly.'},
 storage:{ja:'保存先の空き容量が少なくなっています。まもなく練習を終了します',en:'Storage space is running low. Practice will end shortly.'},
 performance:{ja:'姿勢分析が遅くなっています。まもなく練習を終了します',en:'Pose processing is persistently slow. Practice will end shortly.'},
 failure:{ja:'分析または保存を続けられません。安全のため練習を終了します',en:'Analysis or saving cannot continue. Ending practice safely.'}
};
export function evaluateSafety(s,c=SAFETY_DEFAULTS){
 const limits={...SAFETY_DEFAULTS,...c},rate=Math.max(234375,s.video?.rate??0),videoReserve=Math.max(8*MIB,rate*limits.segmentSeconds*2),poseReserve=Math.max(36000,(s.pose?.rate??3600)*10);
 const videoLeft=limits.videoLimit-(s.video?.used??0),poseLeft=limits.poseLimit-(s.pose?.used??0),timeLeft=limits.maxSeconds-s.elapsed;
 const details={videoLeft,poseLeft,timeLeft,videoSeconds:Math.max(0,Math.min((limits.videoLimit*.8-(s.video?.used??0))/rate,(videoLeft-videoReserve)/rate-30)+limits.warningDelay),poseSeconds:Math.max(0,Math.min(timeLeft-60,(limits.poseLimit*.8-(s.pose?.used??0))/Math.max(3600,s.pose?.rate??0),(poseLeft-poseReserve)/Math.max(3600,s.pose?.rate??0)-30)+limits.warningDelay),videoReserve,poseReserve};
 if(s.failure)return {level:'stop',reason:'failure',detail:s.failure,...details};
 if(s.video?.enabled&&(videoLeft<=videoReserve||s.video.used>=limits.videoLimit*.85))return {level:'stop',reason:'video',...details};
 if(s.pose&&(poseLeft<=poseReserve||s.pose.used>=limits.poseLimit*.85))return {level:'stop',reason:'pose',...details};
 if(timeLeft<=10)return {level:'stop',reason:'time',...details};
 if(Number.isFinite(s.storageLeft)&&s.storageLeft<=limits.reportReserve+(s.unsavedBytes??0)+videoReserve*(s.video?.enabled?1:0)+poseReserve)return {level:'stop',reason:'storage',...details};
 if(s.stalledSeconds>=limits.stallSeconds)return {level:'stop',reason:'performance',...details};
 if(s.video?.enabled&&(s.video.used>=limits.videoLimit*.8||videoLeft<=videoReserve+rate*30))return {level:'warn',reason:'video',...details};
 if(s.pose&&(s.pose.used>=limits.poseLimit*.8||poseLeft<=poseReserve+3600*30))return {level:'warn',reason:'pose',...details};
 if(timeLeft<=60)return {level:'warn',reason:'time',...details};
 if(Number.isFinite(s.storageLeft)&&s.storageLeft<=limits.reportReserve+(s.unsavedBytes??0)+videoReserve*(s.video?.enabled?1:0)+poseReserve+rate*30)return {level:'warn',reason:'storage',...details};
 if(s.slowSeconds>=limits.slowSeconds)return {level:'warn',reason:'performance',...details};
 return {level:'ok',...details};
}
export class CoachSafety{
 constructor(config={}){this.config={...SAFETY_DEFAULTS,...config};this.warning=null;this.stopped=false;}
 update(snapshot,now){const result=evaluateSafety(snapshot,this.config);if(this.stopped)return {...result,action:null};if(result.level==='stop'){this.stopped=true;return {...result,action:'stop'};}if(!this.warning&&result.level==='warn'){this.warning={reason:result.reason,at:now};return {...result,action:'warn'};}if(this.warning&&now-this.warning.at>=this.config.warningDelay){this.stopped=true;return {...result,level:'stop',reason:this.warning.reason,action:'stop'};}return {...result,reason:this.warning?.reason??result.reason,action:null};}
}
