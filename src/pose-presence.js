// Safety gate for live candidate detection, not an identity/person classifier.
export function shootingPose(landmarks,hand='right',aspect=1){
 const ids=hand==='left'?[11,13,15,23,25,27]:[12,14,16,24,26,28];
 const visible=i=>{const p=landmarks?.[i];return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??0)>=.55&&p.x>=-.05&&p.x<=1.05&&p.y>=-.05&&p.y<=1.05;};
 if(!landmarks)return {valid:false,reason:'人物を検出していません'};
 if(!ids.every(visible))return {valid:false,reason:'全身とシュートする腕を映してください'};
 const [s,,,h,k,a]=ids.map(i=>landmarks[i]),torso=Math.hypot((s.x-h.x)*aspect,s.y-h.y),leg=Math.hypot((h.x-a.x)*aspect,h.y-a.y);
 if(torso<.06||torso>.7||leg<.12||s.y>=h.y||k.y<h.y-.08||a.y<k.y-.08)return {valid:false,reason:'全身の姿勢を確認できません'};
 return {valid:true,reason:'人物・必要な関節を検出',center:{x:(s.x+h.x)/2,y:(s.y+h.y)/2},torso};
}
export class PoseContinuity{
 constructor(){this.reset();}
 reset(){this.previous=null;this.since=null;this.ready=false;this.reason='人物を検出していません';}
 update(time,landmarks,hand,aspect){
  const p=shootingPose(landmarks,hand,aspect),old=this.previous;
  const gap=old&&time-old.time>.35,jump=old&&p.valid&&(Math.hypot((p.center.x-old.center.x)*aspect,p.center.y-old.center.y)>.22||Math.abs(Math.log(p.torso/old.torso))>.55);
  const broken=!p.valid||gap||jump;
  if(broken){this.since=null;this.ready=false;}
  this.previous=p.valid?{...p,time}:null;
  if(p.valid){this.since??=time;this.ready=time-this.since>=.25-1e-5;}
  this.reason=!p.valid?p.reason:jump?'カメラ・姿勢の急変。検出を待機':gap||!this.ready?'姿勢の連続性を確認中':p.reason;
  return {ready:this.ready,broken,reason:this.reason};
 }
}
