import {calculateMetrics} from './metrics.js';
import {reviewShot} from './shot-engine.js';
// Shared numeric analysis; only the live delivery confidence policy is separate
// from uncertain shot timing. No alternate score formula or metric values.
export function analyzeCompletedShot(frames,event,reference,metadata,aspect=1){
 const phases=event.phases;
 const selected=frames.filter(f=>f.time>=phases.start-.001&&f.time<=phases.end+.001);
 const analysis=calculateMetrics(selected,phases,metadata.hand,aspect,true);
 analysis.phaseSource='pose';analysis.phaseConfidence='Low';analysis.autoDetection=event;
 const review=reviewShot(reference.analysis,analysis,reference,metadata,{separateTimingConfidence:true});
 analysis.voiceReliability=coachMetricReliability(selected,reference.analysis.frames,metadata.hand,review.comparison.confidence);
 return {analysis,...review};
}
export function compactAnalysis(analysis){const {frames,ballTracking,flightTracking,...data}=analysis;return data;}

export function coachMetricReliability(frames,referenceFrames,hand,confidence){
 const [s,e,w,h,k,a]=hand==='left'?[11,13,15,23,25,27]:[12,14,16,24,26,28];
 const joints={kneeAngle:[h,k,a],kneeArmTiming:[s,e,w,h,k,a],wristHeight:[s,h,w],elbowAngle:[s,e,w],shoulderAngle:[h,s,e],torsoLean:[11,12,23,24],bodyOffset:[11,12,23,24,27,28],hipAngle:[s,h,k],verticalRise:[h,k],armLead:[s,e,w],wristPeakTiming:[s,w],followWrist:[s,h,w],followElbow:[s,e,w]};
 const strong=(frames,ids)=>{if(!frames?.length)return false;const valid=frames.filter(f=>ids.every(id=>{const p=f.landmarks?.[id];return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??0)>=.65;}));return valid.length>=3&&valid.length/frames.length>=.6;};
 return Object.fromEntries(Object.entries(joints).map(([key,ids])=>[key,confidence!=='Low'&&strong(frames,ids)&&strong(referenceFrames,ids)?confidence:'Low']));
}
