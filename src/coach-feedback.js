import {GROUPS} from './scoring-config.js';
export const COACH_RULES=Object.freeze({version:'live-coach-0.4.1',perfect:93,good:82,meaningfulDeviation:.2,smallDeviation:.35,repeatShots:2,cooldownMs:3000});
export const FOCUS_LABELS={automatic:'おまかせ',rhythm:'腕・リリースのタイミング',lower:'脚と腕を伸ばすタイミング',dip:'膝の曲げ（ディップ）',release:'リリースの高さ・動き',elbow:'肘の伸ばし方',follow:'リリース後の腕'};
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
export function selectLegacyCoachFeedback(comparison,{focus='automatic',recent=[],now=Date.now(),shotNumber=recent.length+1,thresholds=COACH_RULES,parameters={}}={}){
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

// One utterance; additive wrapper leaves historical rule replay available.
export function selectCoachFeedback(comparison,options={}){
 const {trunkEstimate,parameters={},recent=[],now=Date.now(),shotNumber=recent.length+1,focus='automatic'}=options;
 const original=selectLegacyCoachFeedback(comparison,options),phrasesShort={legs:['ディップ浅い','Dip shallow'],deep:['ディップ深い','Dip deep'],higher:['リリース低い','Release low'],lowerRelease:['リリース高い','Release high'],elbow:['肘の位置','Elbow position'],elbowRelax:['肘の位置','Elbow position'],arm:['肘の位置','Elbow position'],armWide:['肘の位置','Elbow position'],balance:['バランス','Balance'],lower:['脚と腕のタイミング','Leg and arm timing'],rhythm:['腕のタイミング','Arm timing'],follow:['リリース後も腕を伸ばして','Hold arm after release'],legsLate:['脚の伸ばし遅い','Legs late'],legsEarly:['脚の伸ばし早い','Legs early'],armEarly:['腕の伸ばし早い','Arm early'],armLate:['腕の伸ばし遅い','Arm late'],peakLate:['腕の上げ終わり遅い','Arm late'],peakEarly:['腕の上げ終わり早い','Arm early'],riseHigh:['伸び上がり大きい','Rise large'],riseLow:['伸び上がり小さい','Rise small']};
 const rules={...COACH_RULES,...parameters};let choices=[];
 // Preserve the selected Good/Perfect gates; never inflate the numerical score.
 if(original.trigger||coachDeviations(comparison,parameters).some(m=>inCoachFocus(m,focus)&&m.normalizedDeviation>rules.smallDeviation))choices=coachDeviations(comparison,parameters).filter(m=>inCoachFocus(m,focus)).map(m=>({key:m.key,delta:m.delta,code:m.code,priority:m.priority*(options.policy==='legacy'||Object.hasOwn(parameters.priorityWeights??{},m.key)?1:m.key==='wristHeight'?2:m.key==='kneeAngle'?1.6:1),confidence:options.metricReliability?.[m.key]??comparison.confidence,...Object.fromEntries(['label','tolerance','unit','normalizedDeviation'].map(k=>[k,m[k]]))}));
 if(trunkEstimate?.audioEligible)choices.push({key:'trunkExtension',delta:trunkEstimate.excess,code:'back',priority:Math.max(options.policy==='legacy'?.5:.7,trunkEstimate.excess/8),confidence:trunkEstimate.confidence,label:'体幹後傾・伸展の代理指標'});
 const ordered=choices.sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key));const unique=ordered.filter((m,i)=>ordered.findIndex(v=>(phrasesShort[v.code]?.[0]??v.code)===(phrasesShort[m.code]?.[0]??m.code))===i);
 const valid=unique.filter(m=>['High','Medium'].includes(m.confidence)).slice(0,options.maxItems===1?1:2);
 const signature=m=>m.key+':'+Math.sign(m.delta);
 const lastFor=m=>[...recent].reverse().find(s=>s.coachFeedback?.speak&&(s.coachFeedback.triggers??(s.coachFeedback.trigger?[s.coachFeedback.trigger]:[])).some(t=>signature(t)===signature(m)));
 // Approved longer repetition settings win. A short safety cooldown applies to all new corrections.
 const unsuppressed=valid.filter(m=>{const last=lastFor(m);if(!last)return true;const cooldown=Math.max(3000,rules.cooldownMs),shots=m.key==='trunkExtension'?Math.max(2,rules.repeatShots):rules.suppressCorrections?rules.repeatShots:1;return now-last.timestamp>=cooldown&&shotNumber-last.number>=shots;});
 let output={...original,version:'live-coach-0.10',triggers:[],combined:false};
 if(valid.length){const selected=unsuppressed;const voiced=selected.length?selected:valid;output={...output,code:voiced[0].code,trigger:voiced[0],triggers:voiced,combined:voiced.length===2,text:{ja:voiced.map(m=>m.code==='back'?'腰反りすぎ':phrasesShort[m.code]?.[0]??'フォーム確認').join('、'),en:voiced.map(m=>m.code==='back'?'Back extension':phrasesShort[m.code]?.[1]??'Check form').join(', ')},speak:selected.length>0,reason:voiced.map(m=>m.key==='trunkExtension'?trunkEstimate.reason:`${explainCoachMetric(m)} ${m.label}: Good Formとの差 ${m.delta?.toFixed(3)}、許容差比 ${m.normalizedDeviation?.toFixed(2)}`).join(' / '),suppressedReason:selected.length<valid.length?'同じ指摘の短い間隔での繰り返しを抑えました。':null};}
 else if(original.trigger){output.speak=false;output.reason+=' 項目別の追跡根拠が弱いため、画面の参考表示だけにします。';output.text={ja:phrasesShort[original.code]?.[0]??'フォーム確認',en:phrasesShort[original.code]?.[1]??'Check form'};}
 else if(['good','perfect'].includes(original.code)){
  const evidence=comparison.overall>=(Number.isFinite(options.thresholds?.good)?options.thresholds.good:COACH_RULES.good)&&comparison.metrics.some(m=>!m.excluded&&Number.isFinite(m.delta)&&inCoachFocus(m,focus)&&['High','Medium'].includes(options.metricReliability?.[m.key]??comparison.confidence));
  if(!evidence||trunkEstimate?.alert){output={...output,code:'reference',text:{ja:'フォーム確認',en:'Check form'},speak:false,reason:'十分な比較根拠がない、または独立した体幹の注意点があるため称賛を控えます。'};}
  else output.text={ja:original.code==='perfect'?'パーフェクト！':'グッド！',en:original.code==='perfect'?'Perfect!':'Good!'};
 }
 return output;
}

export function explainCoachMetric(m){
 if(m.key==='kneeArmTiming')return m.delta>0?'Good Formより、腕に対して脚を伸ばし始める時刻が遅い傾向です。脚の伸ばし始めを早めて確認してください。':'Good Formより、腕に対して脚を伸ばし始める時刻が早い傾向です。脚と腕の開始の順番を確認してください。';
 if(m.key==='armLead')return m.delta>0?'リリースまでの区間内で、Good Formより腕を伸ばし始める時刻が早い傾向です。':'リリースまでの区間内で、Good Formより腕を伸ばし始める時刻が遅い傾向です。';
 if(m.key==='wristPeakTiming')return m.delta>0?'リリースに対して腕を上げ終わる時刻がGood Formより遅い傾向です。':'リリースに対して腕を上げ終わる時刻がGood Formより早い傾向です。';
 if(['followWrist','followElbow'].includes(m.key))return 'リリース後の手首・肘の動きが基準より大きい傾向です。シュートした腕を伸ばしたまま保ちましょう。';
 return '同じ撮影条件のGood Formと比較した参考の助言です。';
}
