import {GROUPS} from './scoring-config.js';
export const COACH_RULES=Object.freeze({version:'live-coach-0.4.1',perfect:93,good:82,meaningfulDeviation:.2,smallDeviation:.35,repeatShots:2,cooldownMs:3000});
export const FOCUS_LABELS={automatic:'おまかせ',rhythm:'腕・リリースのタイミング',lower:'脚と腕を伸ばすタイミング',dip:'膝の曲げ（ディップ）',release:'リリースの高さ・動き',elbow:'肘の伸ばし方',follow:'打った後の腕のキープ'};
const phrases={perfect:['とてもいいです','Perfect'],good:['いいです','Good'],view:['全身を映して','Show your whole body'],rhythm:['腕を伸ばすタイミングを確認','Check arm timing'],legs:['ディップ浅い','Dip shallow'],deep:['ディップ深い','Dip deep'],lower:['脚と腕を一緒に伸ばして','Extend legs and arms together'],higher:['リリース低い','Release low'],lowerRelease:['リリース高い','Release high'],follow:['打った後の腕をキープ','Hold your arm after release'],elbow:['肘を伸ばして','Extend your elbow'],elbowRelax:['肘を少しゆるめて','Relax your elbow a little'],arm:['腕の上げ幅が小さい','Arm lift small'],armWide:['腕の上げ幅が大きい','Arm lift large'],balance:['体の軸を安定させて','Keep your body steady'],legsLate:['脚の伸ばし始めが遅い','Leg extension starts late'],legsEarly:['脚の伸ばし始めが早い','Leg extension starts early'],armEarly:['腕の伸ばし始めが早い','Arm extension starts early'],armLate:['腕の伸ばし始めが遅い','Arm extension starts late'],peakLate:['腕の上げ終わりが遅い','Arm lift ends late'],peakEarly:['腕の上げ終わりが早い','Arm lift ends early'],riseHigh:['伸び上がり大きい','Body rise large'],riseLow:['伸び上がり小さい','Body rise small']};
function codeFor(m){
 if(m.key==='kneeArmTiming')return m.delta>0?'legsLate':'legsEarly';
 if(m.key==='armLead')return m.delta>0?'armEarly':'armLate';
 if(m.key==='wristPeakTiming')return m.delta>0?'peakLate':'peakEarly';
 if(m.temporal)return 'rhythm';
 if(['followWrist','followElbow'].includes(m.key))return m.delta>0?'follow':null;
 if(m.key==='wristHeight')return m.delta<0?'higher':'lowerRelease';
 if(m.key==='kneeAngle')return m.delta>0?'legs':'deep';
 if(m.key==='verticalRise')return m.delta>0?'riseHigh':'riseLow';
 if(m.group==='lower')return 'lower';
 if(m.key==='elbowAngle')return m.delta<0?'elbow':'elbowRelax';
 if(m.group==='elbow')return m.delta<0?'arm':'armWide';
 if(m.group==='balance')return 'balance';
 return null;
}
export function inCoachFocus(m,focus){return focus==='automatic'||(focus==='rhythm'?m.temporal&&m.group==='release':focus==='lower'?m.key==='kneeArmTiming':focus==='dip'?m.key==='kneeAngle':m.group===focus);}
function spokenPhrase(code,trigger,comparison,focus,rules){
 if(trigger?.key==='kneeAngle'&&trigger.normalizedDeviation>=1)return trigger.delta>0?['ディップ浅すぎ','Dip too shallow']:['ディップ深すぎ','Dip too deep'];
 if(['good','perfect'].includes(code)&&comparison.metrics.some(m=>!m.excluded&&Number.isFinite(m.delta)&&inCoachFocus(m,focus))&&coachDeviations(comparison,rules).filter(m=>inCoachFocus(m,focus)).every(m=>m.normalizedDeviation<=rules.smallDeviation)){
  const praise={dip:['ディップちょうどいい','Dip looks good'],release:['リリースいいです','Release looks good'],lower:['脚と腕のタイミングいいです','Leg and arm timing looks good'],rhythm:['腕のタイミングいいです','Arm timing looks good'],elbow:['肘の伸びいいです','Elbow extension looks good'],follow:['腕のキープいいです','Follow-through looks good']};if(praise[focus])return praise[focus];
 }
 return phrases[code];
}
export function coachDeviations(comparison,parameters={}){
 const rules={...COACH_RULES,...parameters};
 if(comparison.confidence==='Low')return [];
 return comparison.metrics.filter(m=>!m.excluded&&Number.isFinite(m.delta)&&m.tolerance>0).map(m=>({...m,normalizedDeviation:Math.abs(m.delta)/m.tolerance,code:codeFor(m),priority:Math.abs(m.delta)/m.tolerance*(m.weight??1)*(GROUPS[m.group]?.weight??1)*(rules.priorityWeights?.[m.key]??1)})).filter(m=>m.code&&m.normalizedDeviation>=rules.meaningfulDeviation).sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key));
}
export function selectCoachFeedback(comparison,{focus='automatic',recent=[],now=Date.now(),shotNumber=recent.length+1,thresholds=COACH_RULES,parameters={}}={}){
 const rules={...COACH_RULES,...parameters};
 let code,trigger=null,reason;
 const good=Number.isFinite(thresholds.good)?Math.max(0,Math.min(100,thresholds.good)):COACH_RULES.good,perfect=Number.isFinite(thresholds.perfect)?Math.max(good,Math.min(100,thresholds.perfect)):COACH_RULES.perfect;
 const deviations=coachDeviations(comparison,rules);
 if(comparison.confidence==='Low'||comparison.overall===null){code='view';reason='信頼度が低い、または比較可能な指標が不足しています。フォーム修正は指示しません。';}
 else if(comparison.overall>=perfect){code='perfect';reason=`Form Match ${comparison.overall}% ≥ ${perfect}%。`;}
 else{
  const focused=deviations.filter(m=>inCoachFocus(m,focus));
  const small=focused.every(m=>m.normalizedDeviation<=rules.smallDeviation);
  if(!focused.length||(comparison.overall>=good&&small)){code='good';reason=focused.length?`Form Match ≥ ${good}%、選択範囲の差は許容差の${rules.smallDeviation*100}%以下です。`:`選択フォーカスで、許容差の${rules.meaningfulDeviation*100}%以上の修正対象はありません。`;}
  else{trigger=focused[0];code=trigger.code;reason=`${trigger.label}：差 ${trigger.delta.toFixed(3)} ${trigger.unit} / 許容差 ${trigger.tolerance} = ${(trigger.normalizedDeviation*100).toFixed(1)}%。閾値 ${rules.meaningfulDeviation*100}%。`;}
 }
 const previous=recent.at(-1)?.coachFeedback;
 const sameCorrection=!!trigger&&previous?.code===code&&previous.trigger?.key===trigger.key&&Math.sign(previous.trigger.delta)===Math.sign(trigger.delta);
 const repeatCount=sameCorrection?(previous.repeatCount??1)+1:1;
 const [ja,en]=spokenPhrase(code,trigger,comparison,focus,rules);
 const last=[...recent].reverse().find(s=>s.coachFeedback?.code===code&&s.coachFeedback.speak);
 const repeated=(!trigger||rules.suppressCorrections)&&last&&(shotNumber-last.number<rules.repeatShots||now-last.timestamp<rules.cooldownMs);
 return {version:COACH_RULES.version,code,text:{ja,en},repeatCount,reason,focus,trigger:trigger?{key:trigger.key,label:trigger.label,delta:trigger.delta,tolerance:trigger.tolerance,unit:trigger.unit,normalizedDeviation:trigger.normalizedDeviation,threshold:rules.meaningfulDeviation}:null,speak:!repeated,suppressedReason:repeated?'同じ助言の連続を抑えるため音声を省略しました。':null};
}
