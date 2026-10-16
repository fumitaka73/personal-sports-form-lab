// Frozen candidate/phase math from 92cfe6b. Comparison-only, with shared v1 motion-row input.
function boundaries(rows, release, range) {
  const pre = rows.filter(
    (r) => r.time >= Math.max(range.start, release - 2.2) && r.time < release - 0.12
  );
  const dip = pre.length
    ? pre.reduce((best, r) => (r.wristHeight < best.wristHeight ? r : best))
    : null;
  let start = Math.max(range.start, dip ? dip.time - 0.2 : release - 1.3);
  if (release - start < 0.2) start = Math.max(range.start, release - 0.5);
  let end = Math.min(range.end, release + 1.2);
  const post = rows.filter((r) => r.time > release + 0.5 && r.time <= release + 2);
  for (let i = 2; i < post.length; i++) {
    const group = post.slice(i - 2, i + 1);
    if (group.at(-1).time - group[0].time > 0.4) continue;
    const ys = group.map((r) => r.wristHeight);
    if (Math.max(...ys) - Math.min(...ys) < 0.08) {
      end = Math.min(range.end, Math.max(release + 0.5, group.at(-1).time));
      break;
    }
  }
  if (!(start < release && release < end)) return null;
  return { start, release, end };
}
export function motionSignals(a, b, maxGap = 0.25) {
  const dt = a && b ? b.time - a.time : 0;
  if (dt <= 0 || dt > maxGap)
    return {
      wristVelocity: null,
      elbowVelocity: null,
      elbowChange: null,
      strength: null,
      qualifies: false,
    };
  const elbowChange = Number.isFinite(a.elbow) && Number.isFinite(b.elbow) ? b.elbow - a.elbow : 0;
  const wristVelocity = (b.wristHeight - a.wristHeight) / dt,
    elbowVelocity = elbowChange / dt;
  return {
    wristVelocity,
    elbowVelocity,
    elbowChange,
    strength: Math.max(0, elbowVelocity) / 180 + Math.max(0, wristVelocity) * 0.3,
    qualifies: b.wristHeight >= -0.4 && (wristVelocity >= 0.2 || elbowChange >= 3),
  };
}
export function shotCandidatesFromRows(rows, range, includePose = false) {
  const candidates = [];
  for (let i = 2; i < rows.length - 1; i++) {
    const contact = rows[i - 1],
      before = rows[i - 2],
      away = rows[i],
      next = rows[i + 1];
    const group = [before, contact, away, next];
    if (
      group.some((r) => !r.ball || r.handDistance === null) ||
      new Set(group.map((r) => r.ball.trackId)).size !== 1
    )
      continue;
    if (group.slice(1).some((r, j) => r.time - group[j].time > 0.2)) continue;
    const touching = (r) => r.handDistance <= r.ball.radius * 1.45 + 0.012;
    const detached = (r) => r.handDistance >= r.ball.radius * 1.65 + 0.012;
    const rising = (contact.ball.y - away.ball.y) / (away.time - contact.time) > 0.04;
    const further = next.handDistance >= away.handDistance * 0.85;
    if (
      touching(before) &&
      touching(contact) &&
      detached(away) &&
      detached(next) &&
      rising &&
      further &&
      contact.wristHeight > -0.6
    ) {
      const release = (contact.time + away.time) / 2;
      const phases = boundaries(rows, release, range);
      if (!phases) continue;
      candidates.push({
        phases,
        source: 'ball',
        confidence: 'Medium',
        releaseWindow: { from: contact.time, to: away.time },
        strength: Math.min(...group.map((r) => r.ball.confidence)),
        reason:
          '手の近くにあった丸いオレンジ・茶色の領域が、連続フレームで手から離れて上昇した時刻を候補にしました。2Dの重なりからの推定で、実際の指離れの確定ではありません。',
      });
    }
  }
  const poseCandidates = [];
  if (candidates.length && !includePose) {
    return candidates.map((selected) => ({
      ...selected,
      candidateCount: candidates.length,
      ballTrackedFrames: 0,
    }));
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i],
      signal = motionSignals(a, b, includePose ? 0.6 : 0.25);
    if (!signal.qualifies) continue;
    const strength = signal.strength;
    const release = Math.min(range.end - 0.01, b.time + 0.08),
      phases = boundaries(rows, release, range);
    if (phases) poseCandidates.push({ phases, strength });
  }
  return [
    ...candidates,
    ...poseCandidates.map((best) => ({
      ...best,
      source: 'pose',
      confidence: 'Low',
      releaseWindow: null,
      candidateCount: 0,
      ballTrackedFrames: 0,
      reason:
        'ボール離れを確認できないため、手首の上昇と肘の伸展が大きい場面からリリースを推定しました。',
    })),
  ];
}
