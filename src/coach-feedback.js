import {GROUPS} from './scoring-config.js';
export const COACH_RULES=Object.freeze({version:'live-coach-0.3',perfect:95,good:85,meaningfulDeviation:.2,smallDeviation:.35,repeatShots:2,cooldownMs:3000});
export const FOCUS_LABELS={automatic:'Automatic',rhythm:'Rhythm',lower:'Lower Body',release:'Release',elbow:'Elbow',follow:'Follow-through'};
const phrases={perfect:['パーフェクト','Perfect'],good:['いいです','Good'],view:['全身が映る位置へ','Move into camera view'],rhythm:['リズムを保って','Keep the rhythm'],legs:['もう少し脚を使って','Use your legs more'],lower:['脚の動きを基準に合わせて','Match your leg motion'],higher:['リリースを少し高く','Higher release'],lowerRelease:['リリースを少し低く','Lower release a little'],follow:['フォロースルーをキープ','Hold the follow-through'],elbow:['肘の伸びを基準に合わせて','Match your elbow extension'],arm:['腕の上げ方を基準に合わせて','Match your arm motion'],balance:['姿勢を基準に合わせて','Stay balanced']};
function codeFor(m){
 if(m.temporal)return 'rhythm';
 if(['followWrist','followElbow'].includes(m.key))return m.delta>0?'follow':null;
 if(m.key==='wristHeight')return m.delta<0?'higher':'lowerRelease';
 if(m.key==='kneeAngle')return m.delta>0?'legs':'lower';
 if(m.group==='lower'||m.key==='verticalRise')return 'lower';
 if(m.key==='elbowAngle')return 'elbow';
 if(m.group==='elbow')return 'arm';
 if(m.group==='balance')return 'balance';
 return null;
}
export function coachDeviations(comparison){
 if(comparison.confidence==='Low')return [];
 return comparison.metrics.filter(m=>!m.excluded&&Number.isFinite(m.delta)&&m.tolerance>0).map(m=>({...m,normalizedDeviation:Math.abs(m.delta)/m.tolerance,code:codeFor(m),priority:Math.abs(m.delta)/m.tolerance*(m.weight??1)*(GROUPS[m.group]?.weight??1)})).filter(m=>m.code&&m.normalizedDeviation>=COACH_RULES.meaningfulDeviation).sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key));
}
export function selectCoachFeedback(comparison,{focus='automatic',recent=[],now=Date.now(),shotNumber=recent.length+1}={}){
 let code,trigger=null,reason;
 const deviations=coachDeviations(comparison);
 if(comparison.confidence==='Low'||comparison.overall===null){code='view';reason='信頼度が低い、または比較可能な指標が不足しています。フォーム修正は指示しません。';}
 else if(comparison.overall>=COACH_RULES.perfect){code='perfect';reason=`Form Match ${comparison.overall}% ≥ ${COACH_RULES.perfect}%。`;}
 else{
  const focused=deviations.filter(m=>focus==='automatic'||(focus==='rhythm'?m.temporal:m.group===focus));
  const small=focused.every(m=>m.normalizedDeviation<=COACH_RULES.smallDeviation);
  if(!focused.length||(comparison.overall>=COACH_RULES.good&&small)){code='good';reason=focused.length?`Form Match ≥ ${COACH_RULES.good}%、選択範囲の差は許容差の${COACH_RULES.smallDeviation*100}%以下です。`:`選択フォーカスで、許容差の${COACH_RULES.meaningfulDeviation*100}%以上の修正対象はありません。`;}
  else{trigger=focused[0];code=trigger.code;reason=`${trigger.label}：差 ${trigger.delta.toFixed(3)} ${trigger.unit} / 許容差 ${trigger.tolerance} = ${(trigger.normalizedDeviation*100).toFixed(1)}%。閾値 ${COACH_RULES.meaningfulDeviation*100}%。`;}
 }
 const [ja,en]=phrases[code];
 const last=[...recent].reverse().find(s=>s.coachFeedback?.code===code&&s.coachFeedback.speak);
 const repeated=last&&(shotNumber-last.number<COACH_RULES.repeatShots||now-last.timestamp<COACH_RULES.cooldownMs);
 return {version:COACH_RULES.version,code,text:{ja,en},reason,focus,trigger:trigger?{key:trigger.key,label:trigger.label,delta:trigger.delta,tolerance:trigger.tolerance,unit:trigger.unit,normalizedDeviation:trigger.normalizedDeviation,threshold:COACH_RULES.meaningfulDeviation}:null,speak:!repeated,suppressedReason:repeated?'同じ助言の連続を抑えるため音声を省略しました。':null};
}
