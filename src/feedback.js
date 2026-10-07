const focus = {
  kneeArmTiming: 'Good Formと今回の膝・腕の伸び始めを見比べ、脚から腕へつなぐ順番を1つ意識しましょう。',
  torsoLean: 'リリースで上体がどちらへ傾くかを比較し、Good Formと同じ姿勢をゆっくり再現してみましょう。',
  bodyOffset: '足元に対する上体の位置を見比べ、Good Formの立ち位置とバランスを確認しましょう。',
  verticalRise: 'Good Formと腰の上下移動を見比べ、無理に高く跳ぶより動きをそろえることを意識しましょう。',
  elbowAngle: 'リリース付近で一時停止し、シュート側の肘の伸び具合をGood Formと見比べましょう。',
  shoulderAngle: '腕を上げる方向と肩の位置をGood Formと見比べ、軽い近距離シュートで確かめましょう。',
  kneeAngle: '構えの膝の曲げ具合をGood Formと見比べ、同じ準備姿勢から始めてみましょう。',
  hipAngle: '腰から上体へのつながりをGood Formと見比べ、リリース時の姿勢を確認しましょう。',
  armLead: '腕の伸び始めからリリースまでをゆっくり再生し、Good Formのタイミングをまねてみましょう。',
  wristPeakTiming: 'リリース前後で手首が最高点に来るタイミングをGood Formと見比べましょう。',
  wristHeight: '肩に対する手首の高さをリリース付近で比較し、Good Formの位置を確認しましょう。',
  followWrist: 'ボールを放した後にシュート側の手を少し残し、Good Formと手首の揺れを比べましょう。',
  followElbow: 'リリース後に肘がすぐ戻っていないか確認し、Good Formのフォロースルーを再現しましょう。',
};
export function generateFeedback(comparison) {
  const used = comparison.metrics.filter(m => m.score !== null);
  if (!used.length || comparison.overall === null) return { working: '比較に必要な計測値が不足しています。', difference: '姿勢がはっきり見える動画で再分析してください。', focus: ['全身とシュート側の腕が映る、同じ撮影角度の動画を使いましょう。'] };
  const best = [...used].sort((a, b) => b.score - a.score)[0];
  const worst = [...used].sort((a, b) => a.score - b.score);
  return {
    working: `${best.label}はGood Formとの差が${Math.abs(best.delta).toFixed(2)}${best.unit}です（一致度${Math.round(best.score)}%）。`,
    difference: worst[0].score >= 90 ? '計測した項目ではGood Formに近い動きです。シュート成功率やボール軌道は評価していません。' : `${worst[0].label}が最も大きく異なります。Good Form ${worst[0].refValue.toFixed(2)} → 今回 ${worst[0].value.toFixed(2)}${worst[0].unit}。`,
    focus: worst[0].score >= 90 ? ['今回に近いリズムを保って数本撮り、再現できるか比較しましょう。'] : worst.filter(m => m.score < 90).slice(0, 2).map(m => focus[m.key]),
  };
}
