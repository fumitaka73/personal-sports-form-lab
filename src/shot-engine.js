import { compareAnalyses, calculateMetrics } from './metrics.js';
import { evaluateCheckpoints } from './checkpoints.js';
import { generateFeedback } from './feedback.js';
// The same scoring and feedback pipeline is used by Single Shot and Session.
export function reviewShot(referenceAnalysis, analysis, referenceMeta, metadata, options={}) {
  const comparison = compareAnalyses(referenceAnalysis, analysis, referenceMeta, metadata);
  if(options.separateTimingConfidence){
    const policy=liveComparisonConfidence(referenceAnalysis,analysis,referenceMeta,metadata);
    comparison.baselineConfidence=comparison.confidence;
    Object.assign(comparison,policy);
    if(policy.confidence!=='Low')comparison.warnings=comparison.warnings.filter(w=>!w.startsWith('精度低：'));
    comparison.warnings.push('ライブのリリース時刻は推定です。姿勢計測の品質と時刻の確度を分けて表示し、分析信頼度は最大Mediumに制限しています。');
  }
  return { comparison, checkpointReview: evaluateCheckpoints(analysis, metadata, referenceAnalysis, referenceMeta), feedback: generateFeedback(comparison) };
}

export function liveComparisonConfidence(reference,current,referenceMeta,metadata){
 // Re-evaluate quality with the same metrics engine, ignoring ONLY the explicit
 // estimated-time penalty. Pose gaps, weak motion, low visibility and camera
 // mismatch remain disqualifying, including a weak Good Form.
 const quality=a=>a.frames?.length?calculateMetrics(a.frames,a.phases,a.hand,a.aspect,false):a;
 const result=compareAnalyses(quality(reference),quality(current),referenceMeta,metadata);
 return {confidence:result.confidence==='High'?'Medium':result.confidence,phaseConfidence:'Low',policy:'pose-quality-with-estimated-time-cap'};
}
