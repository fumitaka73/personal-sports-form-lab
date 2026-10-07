import { shotCandidates, shotMotionRows } from './auto-phases.js';
export const SESSION_POSE_THRESHOLDS=Object.freeze({prepHeight:.4,prepElbow:150,peakHeight:.2,minRise:.4,minExtendedElbow:115,minExtension:12,minStrength:.3});
export function detectSessionShots(frames, hand, aspect, range) {
  const candidates = shotCandidates(frames, hand, aspect, range, true);
  const rows = shotMotionRows(frames, hand, aspect);
  const selected = [];
  // Validate a whole shooting cycle rather than counting every velocity spike.
  const evidence = candidate => {
    const release=candidate.phases.release;
    const motion=rows.filter(r=>r.time>=release-1.5&&r.time<=release+0.8);
    if(candidate.source==='ball')return {readyTime:release-.3,peakTime:release};
    if(motion.length<5)return null;
    let best=null;
    for(let i=0;i<motion.length;i++){
      const ready=motion[i];
      if(ready.time>=release||ready.wristHeight>SESSION_POSE_THRESHOLDS.prepHeight)continue;
      const rise=motion.slice(i).filter(r=>r.time<=release+0.8);
      const high=rise.filter(r=>r.time>=ready.time+0.15&&r.wristHeight>=SESSION_POSE_THRESHOLDS.peakHeight&&r.wristHeight-ready.wristHeight>=SESSION_POSE_THRESHOLDS.minRise);
      // At least two successive high frames: a single tracking jump is insufficient.
      const peak=high.find((r,j)=>j&&r.time-high[j-1].time<=0.2);
      if(!peak)continue;
      const ascent=rise.filter(r=>r.time<=peak.time);
      if(ascent.some((r,j)=>j&&r.time-ascent[j-1].time>0.5))continue;
      const bent=Number.isFinite(ready.elbow)&&ready.elbow<=SESSION_POSE_THRESHOLDS.prepElbow;
      const extended=Number.isFinite(peak.elbow)&&peak.elbow>=SESSION_POSE_THRESHOLDS.minExtendedElbow&&peak.elbow-ready.elbow>=SESSION_POSE_THRESHOLDS.minExtension;
      if(candidate.source==='pose'&&!(bent&&extended))continue;
      best={readyTime:ready.time,peakTime:peak.time};break;
    }
    return best;
  };
  candidates.sort((a,b) => (b.source==='ball')-(a.source==='ball') || b.strength-a.strength);
  for (const candidate of candidates) {
    if(candidate.source==='pose' && candidate.strength<SESSION_POSE_THRESHOLDS.minStrength)continue;
    const cycle=evidence(candidate);if(!cycle)continue;
    if(selected.some(c=>Math.abs(c.phases.release-candidate.phases.release)<1.5||Math.abs(c.cycle.readyTime-cycle.readyTime)<0.5))continue;
    selected.push({...candidate,cycle});
  }
  selected.sort((a,b)=>a.phases.release-b.phases.release);
  // A follow-through fluctuation cannot become another shot without lowering
  // the hand for a new preparation. Keep this rule confined to Session.
  const cycles=[];
  for(const candidate of selected){
    const previous=cycles.at(-1);
    const reset=!previous||candidate.source==='ball'||rows.some((r,j)=>r.time>previous.cycle.peakTime&&r.time<candidate.phases.release&&j+1<rows.length&&rows[j+1].time<candidate.phases.release&&rows[j+1].time-r.time<=0.2&&((r.wristHeight<=0.4&&rows[j+1].wristHeight<=0.4)||(r.elbow<140&&rows[j+1].elbow<140)));
    if(reset)cycles.push(candidate);
  }
  return cycles.map((c,i)=> {
    const start = Math.max(c.phases.start, i ? (cycles[i-1].phases.release+c.phases.release)/2 : range.start);
    const end = Math.min(c.phases.end, i<cycles.length-1 ? (c.phases.release+cycles[i+1].phases.release)/2 : range.end);
    return {...c, phases:{start,release:c.phases.release,end}};
  });
}
export function summarizeSession(shots) {
  const values=shots.filter(s=>!s.excluded).map(s=>s.comparison.overall).filter(Number.isFinite);
  const average=a=>a.length?a.reduce((sum,v)=>sum+v,0)/a.length:null;
  const included=shots.filter(s=>!s.excluded);
  const half=Math.ceil(included.length/2),first=included.slice(0,half).map(s=>s.comparison.overall).filter(Number.isFinite),last=included.slice(half).map(s=>s.comparison.overall).filter(Number.isFinite);
  return {count:included.length,scoredCount:values.length,average:average(values),best:values.length?Math.max(...values):null,change:first.length&&last.length?average(last)-average(first):null};
}
