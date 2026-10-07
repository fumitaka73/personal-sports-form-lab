import { compareAnalyses } from './metrics.js';
import { evaluateCheckpoints } from './checkpoints.js';
import { generateFeedback } from './feedback.js';
// The same scoring and feedback pipeline is used by Single Shot and Session.
export function reviewShot(referenceAnalysis, analysis, referenceMeta, metadata) {
  const comparison = compareAnalyses(referenceAnalysis, analysis, referenceMeta, metadata);
  return { comparison, checkpointReview: evaluateCheckpoints(analysis, metadata, referenceAnalysis, referenceMeta), feedback: generateFeedback(comparison) };
}
