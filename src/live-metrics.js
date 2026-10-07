import {angle} from './metrics.js';
export const BODY_IDS=[11,12,13,14,15,16,23,24,25,26,27,28];
export function liveMetrics(landmarks,aspect=1){
 const p=landmarks;const visible=i=>p?.[i]&&Number.isFinite(p[i].x)&&Number.isFinite(p[i].y)&&(p[i].visibility??0)>=.55;
 const point=i=>({x:p[i].x*aspect,y:p[i].y});
 const joint=(a,b,c)=>[a,b,c].every(visible)?angle(point(a),point(b),point(c)):null;
 const count=BODY_IDS.filter(visible).length;
 const confidence=p?BODY_IDS.reduce((s,i)=>s+(p[i]?.visibility??0),0)/BODY_IDS.length:0;
 let torsoLean=null;
 if([11,12,23,24].every(visible)){
  const shoulder={x:(p[11].x+p[12].x)/2,y:(p[11].y+p[12].y)/2},hip={x:(p[23].x+p[24].x)/2,y:(p[23].y+p[24].y)/2};
  if(Math.hypot((shoulder.x-hip.x)*aspect,shoulder.y-hip.y)>.01)torsoLean=Math.atan2((shoulder.x-hip.x)*aspect,hip.y-shoulder.y)*180/Math.PI;
 }
 return {rightElbow:joint(12,14,16),leftElbow:joint(11,13,15),rightKnee:joint(24,26,28),leftKnee:joint(23,25,27),torsoLean,confidence,visibleCount:count,quality:count===12?'Full body':count?'Partial body':'Not detected'};
}
