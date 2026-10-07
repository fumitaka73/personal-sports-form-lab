export const ANALYSIS_VERSION = 'basketball-0.3.0';
export const METRICS = {
  kneeArmTiming: { group: 'lower', label: '脚と腕の伸展タイミング差', unit: '動作比', tolerance: 0.4, weight: 1, temporal: true },
  torsoLean: { group: 'balance', label: 'リリース付近の体幹の傾き', unit: '°', tolerance: 25, weight: 1 },
  bodyOffset: { group: 'balance', label: '足元に対する上体のずれ', unit: '胴長比', tolerance: 0.7, weight: 1 },
  verticalRise: { group: 'balance', label: '腰の上下移動', unit: '胴長比', tolerance: 0.6, weight: 0.5, shotDependent: true },
  elbowAngle: { group: 'elbow', label: 'リリース付近の肘角度', unit: '°', tolerance: 35, weight: 1 },
  shoulderAngle: { group: 'elbow', label: 'リリース付近の肩角度', unit: '°', tolerance: 35, weight: 0.5 },
  kneeAngle: { group: 'lower', label: '開始時の膝角度', unit: '°', tolerance: 35, weight: 0.5, shotDependent: true },
  hipAngle: { group: 'balance', label: 'リリース付近の股関節角度', unit: '°', tolerance: 30, weight: 0.5, shotDependent: true },
  armLead: { group: 'release', label: '腕の伸展開始からリリースまで', unit: '動作比', tolerance: 0.4, weight: 1, temporal: true },
  wristPeakTiming: { group: 'release', label: '手首が最高点になるタイミング', unit: '動作比', tolerance: 0.35, weight: 1, temporal: true },
  wristHeight: { group: 'release', label: '肩からの手首の高さ', unit: '胴長比', tolerance: 0.6, weight: 0.5 },
  followWrist: { group: 'follow', label: 'フォロースルー中の手首の揺れ', unit: '胴長比', tolerance: 0.3, weight: 1 },
  followElbow: { group: 'follow', label: 'フォロースルー中の肘角度の揺れ', unit: '°', tolerance: 20, weight: 1 },
};
export const GROUPS = {
  lower: { label: '下半身のタイミング', weight: 0.2 },
  balance: { label: '体のバランス', weight: 0.2 },
  elbow: { label: 'シュート側の肘', weight: 0.2 },
  release: { label: 'リリース動作', weight: 0.25 },
  follow: { label: 'フォロースルー', weight: 0.15 },
};
