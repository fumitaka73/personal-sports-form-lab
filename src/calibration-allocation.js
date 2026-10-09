import {usableDetectionSession,feedbackEligible,EVIDENCE_MIN} from './personal-calibration.js';
import {voiceReviewed} from './quick-review.js';
export function evidenceCounts(s,cases){
 const group=cases.filter(c=>c.source.mode==='live'&&c.source.recordId===s.id);
 return {detector:usableDetectionSession({...s,chunks:s.chunks?.length?s.chunks:s.count?[{}]:[]},cases)?0:s.truth.events.length,feedback:group.filter(c=>!c.manualAdded&&feedbackEligible(c)&&voiceReviewed(c)).length};
}
// Allocation depends on review availability and chronology, never prediction accuracy.
// Existing roles, including all locked exclusions, are preserved.
export function allocateDatasets(sessions,cases,datasets){
 const next=structuredClone(datasets),ordered=[...sessions].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
 const counts=s=>evidenceCounts({...s,...next[s.id]},cases);
 const totals=split=>ordered.reduce((v,s)=>{if(next[s.id]?.split!==split)return v;const n=counts(s);for(const kind of ['detector','feedback'])if(n[kind]){v[kind].sessions++;v[kind].items+=n[kind];}return v;},{detector:{sessions:0,items:0},feedback:{sessions:0,items:0}});
 const pool=ordered.filter(s=>{const d=next[s.id],n=counts(s);return !d?.lockedAt&&!d?.manualAssignedAt&&!['training','validation'].includes(d?.split)&&(n.detector||n.feedback);});
 while(pool.length){
  const train=totals('training'),needed=['detector','feedback'].filter(k=>train[k].sessions<EVIDENCE_MIN.sessions||train[k].items<20);
  const ranked=pool.map(s=>{const n=counts(s);let help=0,waste=0;for(const k of needed)if(n[k]){const missing=Math.max(0,20-train[k].items);help+=missing?Math.min(n[k]/missing,1):0;if(train[k].sessions<EVIDENCE_MIN.sessions)help+=.5;waste+=Math.max(0,n[k]-missing)/20;}return {s,help,waste};}).filter(v=>v.help>0).sort((a,b)=>b.help-a.help||a.waste-b.waste||a.s.createdAt-b.s.createdAt||a.s.id.localeCompare(b.s.id));
  if(!ranked.length)break;const s=ranked[0].s;next[s.id]={...next[s.id],split:'training',autoAssignedAt:Date.now()};pool.splice(pool.indexOf(s),1);
 }
 for(const s of pool)next[s.id]={...next[s.id],split:'validation',autoAssignedAt:Date.now()};
 return next;
}
export function evidenceProgress(sessions,cases,datasets){
 const output={};for(const kind of ['detector','feedback']){output[kind]={};for(const split of ['training','validation']){const selected=sessions.filter(s=>datasets[s.id]?.split===split).map(s=>evidenceCounts({...s,...datasets[s.id]},cases)[kind]).filter(n=>n>0);output[kind][split]={sessions:selected.length,items:selected.reduce((a,b)=>a+b,0),requiredSessions:EVIDENCE_MIN.sessions,requiredItems:split==='training'?20:10};}}
 return output;
}
export function sufficient(progress){return Object.values(progress).every(v=>v.sessions>=v.requiredSessions&&v.items>=v.requiredItems);}
