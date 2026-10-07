import { shotCandidates } from './auto-phases.js';
export function detectSessionShots(frames, hand, aspect, range) {
  const candidates = shotCandidates(frames, hand, aspect, range, true);
  const selected = [];
  // Suppress repeated detections of one movement. Ball evidence takes priority.
  candidates.sort((a,b) => (b.source==='ball')-(a.source==='ball') || b.strength-a.strength);
  for (const candidate of candidates) {
    if(candidate.source==='pose' && candidate.strength<0.3)continue;
    if(selected.some(c=>Math.abs(c.phases.release-candidate.phases.release)<1.5))continue;
    selected.push(candidate);
  }
  selected.sort((a,b)=>a.phases.release-b.phases.release);
  return selected.map((c,i)=> {
    const start = Math.max(c.phases.start, i ? (selected[i-1].phases.release+c.phases.release)/2 : range.start);
    const end = Math.min(c.phases.end, i<selected.length-1 ? (c.phases.release+selected[i+1].phases.release)/2 : range.end);
    return {...c, phases:{start,release:c.phases.release,end}};
  });
}
export function summarizeSession(shots) {
  const values=shots.map(s=>s.comparison.overall).filter(Number.isFinite);
  const average=a=>a.length?a.reduce((sum,v)=>sum+v,0)/a.length:null;
  const half=Math.ceil(shots.length/2),first=shots.slice(0,half).map(s=>s.comparison.overall).filter(Number.isFinite),last=shots.slice(half).map(s=>s.comparison.overall).filter(Number.isFinite);
  return {count:shots.length,scoredCount:values.length,average:average(values),best:values.length?Math.max(...values):null,change:first.length&&last.length?average(last)-average(first):null};
}
