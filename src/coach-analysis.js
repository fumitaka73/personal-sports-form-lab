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
 return {analysis,...review};
}
export function compactAnalysis(analysis){const {frames,ballTracking,flightTracking,...data}=analysis;return data;}
