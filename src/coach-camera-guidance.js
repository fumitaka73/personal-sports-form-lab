import {BODY_IDS} from './live-metrics.js';
// Pose can indicate framing/visibility, but cannot prove an obstruction or
// camera shake. Do not diagnose these causes from player movement alone.
export function cameraGuidance(frames,hand='right'){
 if(frames.length<5)return null;
 const last=frames.at(-1).time,rows=frames.filter(f=>f.time>=last-5);
 if(rows.length<5||last-rows[0].time<2)return null;
 const counts={missing:0,far:0,clipped:0,partial:0};
 for(const f of rows){
  const p=f.landmarks,visible=BODY_IDS.filter(i=>p?.[i]&&Number.isFinite(p[i].x)&&Number.isFinite(p[i].y)&&(p[i].visibility??0)>=.55);
  if(visible.length<3){counts.missing++;continue;}
  const points=visible.map(i=>p[i]),height=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
  if(visible.length>=8&&height<.3){counts.far++;continue;}
  if(points.some(p=>p.x<.025||p.x>.975||p.y<.025||p.y>.975)){counts.clipped++;continue;}
  const required=hand==='left'?[11,13,15,23,25,27]:[12,14,16,24,26,28];
  if(required.some(i=>!visible.includes(i)))counts.partial++;
 }
 const code=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];if(counts[code]/rows.length<.6)return null;
 const phrases={missing:['全身を映して','Body not detected. Secure the camera and check full-body framing and obstructions'],far:['少しカメラに近づいて','You look small in the frame. Move a little closer'],clipped:['全身が入る位置へ','Your body is cut off. Adjust the camera to show your whole body'],partial:['シュートする腕を映して','Your body or shooting arm is hard to see. Check camera position and obstructions']};
 return {code,text:{ja:phrases[code][0],en:phrases[code][1]},reason:'直近5秒の姿勢フレームの60%以上で撮影上の問題を観測'};
}
