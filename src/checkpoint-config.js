// Personal coaching targets requested by the user; not universal biomechanical norms.
export const CHECKPOINT_VERSION = 'personal-checks-0.4.0';
export const UNRATED_SCORE = 50;
export const CHECK_TARGETS = {
  releaseHeight: { min: -0.25, max: 0.15, tolerance: 0.55, unit: '胴長比' },
  noseDistance: { min: 0, max: 0.25, tolerance: 0.65, unit: '胴長比' },
  backLean: { min: -1, max: 0.12, tolerance: 0.4, unit: '胴長比' },
  dipHeight: { min: -0.35, max: 0.05, tolerance: 0.6, unit: '胴長比' },
  bodyDistance: { min: 0, max: 0.35, tolerance: 0.65, unit: '胴長比' },
  faceDistance: { min: 0, max: 0.3, tolerance: 0.65, unit: '胴長比' },
  bentElbow: { min: 25, max: 95, tolerance: 85, unit: '°' },
  elbowCross: { min: 0, max: 0.05, tolerance: 0.6, unit: '肩幅比' },
  wiper: { min: 0, max: 0.35, tolerance: 0.7, unit: '胴長比' },
  shoulderTilt: { min: 0, max: 8, tolerance: 30, unit: '°' },
  shoulderForward: { min: -0.15, max: 0.15, tolerance: 0.6, unit: '肩幅比' },
  abruptness: { min: 0, max: 12, tolerance: 45, unit: '胴長/秒²' },
  stance: { min: 0.5, max: 1.1, tolerance: 1, unit: '肩幅比' },
  holdingSide: { min: 0.1, max: 0.65, tolerance: 0.8, unit: '胴長比' },
  followSide: { min: -0.05, max: 0.4, tolerance: 0.8, unit: '胴長比' },
  fingerDirection: { min: 0.7, max: 1, tolerance: 1.7, unit: '方向一致（cos）' },
};
