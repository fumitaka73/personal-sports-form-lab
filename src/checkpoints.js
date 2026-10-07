import { angle } from './metrics.js';
import { CHECKPOINT_VERSION, CHECK_TARGETS, UNRATED_SCORE } from './checkpoint-config.js';
const finite = Number.isFinite;
const mean = a => a.length ? a.reduce((s,v) => s+v,0)/a.length : null;
const length = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const center = (a,b) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const has = (p,...ids) => ids.every(i=>p?.[i] && finite(p[i].x) && finite(p[i].y) && (p[i].visibility??0)>=0.2);
export function targetScore(value, target) {
  if (!finite(value)) return UNRATED_SCORE;
  const deviation = Math.max(target.min-value, value-target.max, 0);
  return Math.round(Math.max(0,100*(1-deviation/target.tolerance)));
}
function unknown(label, explanation) {
  return {label,score:UNRATED_SCORE,status:'unrated',value:null,comment:explanation,source:'未評価・仮置き50（映像からの推定値ではありません）'};
}
function measured(key,label,value,comment,reason,forceEstimate=false) {
  if (!finite(value)) return unknown(label,reason || '必要な関節が見えず評価できません。');
  return {key,label,value,score:targetScore(value,CHECK_TARGETS[key]),status:'estimated',target:CHECK_TARGETS[key],comment,source:forceEstimate ? '代用指標による推定・精度低' : '姿勢推定からの参考評価'};
}
function group(id,label,parts,weight=1) {
  const evaluated=parts.filter(p=>p.status!=='unrated');
  return {id,label,parts,weight,score:evaluated.length ? Math.round(mean(evaluated.map(p=>p.score))) : UNRATED_SCORE,status:evaluated.length?'estimated':'unrated',partial:evaluated.length<parts.length,comment:evaluated.length?evaluated.filter(p=>p.score<85).map(p=>p.comment).join(' ')||'計測できた範囲では、指定した目標に近い動きです。': '未評価です。50点は表示用の仮置きで、良い・悪いの判定ではありません。'};
}
export function evaluateCheckpoints(analysis, metadata={}, referenceAnalysis=null, referenceMetadata={}) {
  const hand=analysis.hand??metadata.hand??'right';
  const [s,e,w,h,k,a,index]=hand==='right'?[12,14,16,24,26,28,20]:[11,13,15,23,25,27,19];
  const front=metadata.cameraAngle==='front'||metadata.cameraAngle==='diagonal';
  const side=metadata.cameraAngle==='side';
  const rows=(analysis.frames??[]).map(f=>{
    const p=f.landmarks?.map(point=>({...point,x:point.x*(analysis.aspect??1),z:finite(point.z)?point.z*(analysis.aspect??1):null}));
    if(!p) return null;
    const torso=has(p,s,h)?length(p[s],p[h]):null;
    let scale=torso>0.01?torso:null;
    let scaleEstimated=false;
    if(!scale){
      const shoulderWidth=has(p,11,12)?length(p[11],p[12]):null;
      const headWidth=has(p,0,7)?length(p[0],p[7]):has(p,0,8)?length(p[0],p[8]):null;
      scale=shoulderWidth>0.04?shoulderWidth*1.4:headWidth>0.02?headWidth*4:null;
      scaleEstimated=Boolean(scale);
    }
    return {time:f.time,p,scale,scaleEstimated};
  }).filter(Boolean);
  const pre=rows.filter(r=>r.time<=analysis.phases.release), post=rows.filter(r=>r.time>=analysis.phases.release);
  function nearRelease(ids,needsScale=true) {
    const usable=rows.filter(r=>has(r.p,...ids)&&(!needsScale||r.scale));
    return usable.length?usable.reduce((best,r)=>Math.abs(r.time-analysis.phases.release)<Math.abs(best.time-analysis.phases.release)?r:best):null;
  }
  const r=nearRelease([0,s,w]);
  const releaseHeight=r?(r.p[0].y-r.p[w].y)/r.scale:null;
  const noseDistance=r?length(r.p[0],r.p[w])/r.scale:null;
  const releaseNote='ボールではなく手首を代用します。鼻付近は利用者が指定した目標です。';
  const height=measured('releaseHeight','リリース位置が高すぎないか',releaseHeight, releaseHeight>0.15?'推定リリース位置（手首）が鼻より高すぎる傾向です。鼻付近という指定目標より上にあります。':releaseHeight< -0.25?'推定リリース位置（手首）が鼻より低い傾向です。':'推定リリース位置（手首）は鼻付近の高さです。', '鼻・手首・胴体が検出できず、リリースの高さは未評価です。',true);
  const nose=measured('noseDistance','鼻のあたりでリリースできているか',noseDistance,noseDistance>0.25?'リリース付近の手首が鼻から離れています。高さに加えて、顔との距離も確認してください。':'リリース付近の手首は鼻の近くにあります。','鼻との距離を計測できません。ボールの実際の離れ位置は追跡していません。',true);
  height.note=nose.note=releaseNote+(r?.scaleEstimated?' 胴体が見えないため、肩幅または顔の大きさから換算した近似です。':'');
  const releaseApprox=Boolean(analysis.phaseEstimated)||(r&&Math.abs(r.time-analysis.phases.release)>0.15);
  if(releaseApprox) [height,nose].forEach(part=>part.note+=' リリース時刻または使用フレームも近似です。');

  // Lumbar curvature itself cannot be measured from shoulder/hip/knee landmarks.
  const backRow=side?nearRelease([0,s,h,k]):null;
  const facing=backRow?Math.sign(backRow.p[0].x-backRow.p[s].x):0;
  const facingClear=backRow&&Math.abs(backRow.p[0].x-backRow.p[s].x)/backRow.scale>0.04;
  const backLean=facingClear?(backRow.p[h].x-backRow.p[s].x)*facing/backRow.scale:null;
  const back=measured('backLean','反り腰の兆候',backLean,backLean>0.12?'上体が骨盤より後ろに傾く兆候があります（反り腰の可能性・推定）。腰椎の反り自体は確認できません。':backLean< -0.1?'上体が骨盤より前に傾く傾向です。反り腰そのものを判定する数値ではありません。':'上体の後ろへの傾きは小さいですが、反り腰がないと断定するものではありません。',side?'肩・腰・顔の向きが読み取れず、反り腰の代用評価もできません。':'正面・45度では腰の反りを判定できません。横からの動画で確認してください。',true);
  back.note='横動画の肩と骨盤の前後差を代用。骨盤傾斜・腰椎の反り・痛みは計測していません。';

  const dipRows=pre.filter(t=>has(t.p,s,w,h)&&t.scale);
  const dip=dipRows.length?dipRows.reduce((best,t)=>((t.p[w].y-t.p[s].y)/t.scale)>((best.p[w].y-best.p[s].y)/best.scale)?t:best):null;
  const dipHeight=dip?(dip.p[w].y-dip.p[h].y)/dip.scale:null;
  const bodyDistance=dip?Math.abs(dip.p[w].x-dip.p[h].x)/dip.scale:null;
  const path=dipRows.map(t=>({x:(t.p[w].x-t.p[h].x)/t.scale,y:(t.p[w].y-t.p[h].y)/t.scale,time:t.time}));
  const turns=[];
  for(let i=2;i<path.length;i++){
    const [a,b,c]=path.slice(i-2,i+1);
    if(c.time-a.time>0.4) continue;
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(Math.abs(cross)>0.002) turns.push(Math.sign(cross));
  }
  const hasS=turns.some(v=>v>0)&&turns.some(v=>v<0);
  const sCurve=path.length>=5?{label:'緩いS字の軌道',score:hasS?85:60,status:'estimated',value:hasS?1:0,source:'手首軌道の曲がり方による代用推定',comment:hasS?'手首軌道に左右の曲がりが見られます。ボールのS字軌道とは限りません。':'手首軌道から緩いS字を確認できません。カメラ方向や動作区間にも左右されます。'}:unknown('緩いS字の軌道','手首の軌道が不足し、S字は確認できません。');
  const dipCheck=group('dip','1. ディップ：お腹・体に近い・緩いS字',[
    measured('dipHeight','お腹付近のディップ',dipHeight,dipHeight>0.05?'手首のディップ位置がお腹より下がりすぎる傾向です。':dipHeight< -0.35?'手首のディップが高めで、お腹付近まで下がっていません。':'手首のディップ位置はお腹付近です。',null,true),
    measured('bodyDistance','体に近いか',bodyDistance,bodyDistance>0.35?'ディップ時の手首が体から離れる傾向です。':'手首は体に近い位置を通っています。',null,true),sCurve]);
  const setRows=pre.filter(t=>has(t.p,0,s,e,w)&&t.scale);
  const set=setRows.length?setRows.reduce((best,t)=>length(t.p[0],t.p[w])/t.scale<length(best.p[0],best.p[w])/best.scale?t:best):null;
  const faceDistance=set?length(set.p[0],set.p[w])/set.scale:null;
  const elbow=set?angle(set.p[s],set.p[e],set.p[w]):null;
  const faceCheck=group('face','2. 鼻・顔に近いセットとリリース',[
    measured('faceDistance','セット時の顔との距離',faceDistance,faceDistance>0.3?'セット時に手首が顔から離れている傾向です。':'セット時の手首は顔に近い位置です。',null,true),
    measured('bentElbow','セット時に肘をかなり曲げる',elbow,elbow>95?'顔に近づけた場面でも肘の曲がりが浅い傾向です。':'セット時に肘を曲げている傾向です。'),height,nose],3);

  const armRows=front?pre.filter(t=>has(t.p,11,12,e,w,h)&&t.scale):[];
  const crossings=armRows.map(t=>{
    const mid=center(t.p[11],t.p[12]), width=length(t.p[11],t.p[12]), sign=Math.sign(t.p[s].x-mid.x);
    return width>0.02?Math.max(0,(mid.x-t.p[e].x)*sign/width):null;
  }).filter(finite);
  const elbowCross=crossings.length?Math.max(...crossings):null;
  const lateral=armRows.map(t=>(t.p[w].x-t.p[s].x)/t.scale);
  const wiper=lateral.length>=3?Math.max(...lateral)-Math.min(...lateral):null;
  const armCheck=group('arm','3. 内側への入り・ワイパー',[
    measured('elbowCross','腕が内側に入っていないか',elbowCross,elbowCross>0.05?'肘が体の中心線を越えて内側に入る傾向です。':'肘が中心線を越える動きは小さめです。','横動画では内側への入りを読み取れません。',true),
    measured('wiper','ワイパーのような横振れ',wiper,wiper>0.35?'手首の横移動が大きく、ワイパーのように振れる可能性があります。':'手首の横移動は小さめです。','腕の横振れを評価できる正面の場面が不足しています。',true)]);
  const shoulderRow=front?nearRelease([11,12],false):null;
  const shoulderWidth=shoulderRow?length(shoulderRow.p[11],shoulderRow.p[12]):null;
  const shoulderTilt=shoulderWidth>0.02?Math.atan2(Math.abs(shoulderRow.p[11].y-shoulderRow.p[12].y),Math.abs(shoulderRow.p[11].x-shoulderRow.p[12].x))*180/Math.PI:null;
  let forward=shoulderWidth>0.02&&finite(shoulderRow.p[11].z)&&finite(shoulderRow.p[12].z)?(shoulderRow.p[11].z-shoulderRow.p[12].z)/shoulderWidth:null;
  let depthSource='モデルの奥行き推定を代用。カメラへの体の向きにも左右されます。';
  if(metadata.cameraAngle==='diagonal' && referenceMetadata.cameraAngle!==metadata.cameraAngle) forward=null;
  if(finite(forward)&&referenceAnalysis&&referenceMetadata.cameraAngle===metadata.cameraAngle){
    const baseline=evaluateShoulderDepth(referenceAnalysis);
    if(finite(baseline)){forward-=baseline;depthSource='同じ撮影角度のGood Formとの肩の推定奥行き差です。';}
  }
  const shoulderForward=measured('shoulderForward','右肩が前に出ていないか',forward,forward>0.15?'右肩が前に出ている可能性があります（奥行きの代用推定）。':forward< -0.15?'左肩が前に出ている可能性があります（奥行きの代用推定）。':'左右の肩の推定前後差は小さめです。','この撮影角度では右肩の前後差を評価できません。',true);shoulderForward.note=depthSource;
  const shoulderCheck=group('shoulders','4. 肩の水平・右肩の出',[
    measured('shoulderTilt','肩は左右まっすぐか',shoulderTilt,shoulderTilt>8?'肩のラインが傾いています。カメラの傾きも確認してください。':'肩のラインはほぼ水平です。','横からの映像では左右の肩の水平を判定できません。',true),shoulderForward]);

  const accelerations=[];
  for(let i=2;i<dipRows.length;i++){
    const [a,b,c]=dipRows.slice(i-2,i+1);const dt1=b.time-a.time,dt2=c.time-b.time;
    if(dt1<=0||dt2<=0||dt1>0.25||dt2>0.25)continue;
    const x=t=>(t.p[w].x-t.p[s].x)/t.scale,y=t=>(t.p[w].y-t.p[s].y)/t.scale;
    accelerations.push(Math.hypot((x(c)-x(b))/dt2-(x(b)-x(a))/dt1,(y(c)-y(b))/dt2-(y(b)-y(a))/dt1)/((dt1+dt2)/2));
  }
  const abruptness=accelerations.length>=3?mean(accelerations):null;
  const relaxCheck=group('relax','5. リラックス・力み（滑らかさの代用）',[
    measured('abruptness','手首の動きの滑らかさ',abruptness,abruptness>12?'手首の動きに急な変化が多めです。力みの可能性を動画で確認してください。検出の揺れや速い動きでも同じ結果になります。':'手首の動きの急変は小さめです。ただし筋肉の力み・リラックス自体は判定できません。','力みは映像だけでは断定できず、滑らかさの代用指標も不足しています。',true)]);
  const stanceRows=front?pre.filter(t=>has(t.p,11,12,27,28)):[];
  const widths=stanceRows.map(t=>length(t.p[11],t.p[12])>0.02?length(t.p[27],t.p[28])/length(t.p[11],t.p[12]):null).filter(finite);
  const stance=mean(widths);
  const baseCheck=group('base','6. 狭めの足幅・反り腰の兆候',[
    measured('stance','足幅は狭めか',stance,stance>1.1?'指定目標（肩幅程度まで）より足幅が広い傾向です。':stance<0.5?'足幅がかなり狭い傾向です。バランスも確認してください。':'足幅は指定した狭めの範囲です。','足元または正面の肩幅が見えず、足幅は評価できません。',true),back],3);
  const holding=front&&dip&&has(dip.p,11,12)?(dip.p[w].x-center(dip.p[11],dip.p[12]).x)*Math.sign(dip.p[s].x-center(dip.p[11],dip.p[12]).x)/dip.scale:null;
  const holdCheck=group('hold','7. ボール持ち・手の接触',[
    measured('holdingSide','シュート側寄りの持ち位置',holding,holding<0.1?'手首の位置がシュート側より中央・逆側に寄る傾向です。':holding>0.65?'手首の位置がシュート側へ離れすぎる傾向です。':'手首はシュート側寄りの位置です。','ボール位置は追跡していません。手首の左右位置も読み取れません。',true),
    unknown('乗せすぎになっていないか','ボールと指の接触を検出していないため、乗せすぎは未評価です。'),
    unknown('手がべたっとついていないか','手のひらの接触面は姿勢推定では分からず、未評価です。')]);
  const followRows=front?post.filter(t=>has(t.p,11,12,s,w,h)&&t.scale):[];
  const following=followRows.length>=2?(followRows.at(-1).p[w].x-followRows.at(-1).p[s].x)/followRows.at(-1).scale-(followRows[0].p[w].x-followRows[0].p[s].x)/followRows[0].scale:null;
  const followSign=followRows.length?Math.sign(followRows[0].p[s].x-center(followRows[0].p[11],followRows[0].p[12]).x):null;
  const followSide=finite(following)?following*followSign:null;
  const fingerRows=post.filter(t=>has(t.p,w,index));
  const goal={right:{x:1,y:0},left:{x:-1,y:0},up:{x:0,y:-1}}[metadata.goalDirection];
  const directions=goal?fingerRows.map(t=>{
    const dx=t.p[index].x-t.p[w].x,dy=t.p[index].y-t.p[w].y,d=Math.hypot(dx,dy);
    return d>0.01?(dx*goal.x+dy*goal.y)/d:null;
  }).filter(finite):[];
  const fingerCheck=measured('fingerDirection','ゴール方向への手の向き（人差し指を代用）',mean(directions),mean(directions)<0.7?'推定した手の向きが指定のゴール方向からずれています。中指の方向を直接計測した結果ではありません。':'推定した手の向きは指定のゴール方向に近い傾向です。中指は検出していません。','中指は検出していません。ゴールの画面上の方向が未指定、または代用する人差し指が見えず未評価です。',true);
  const followCheck=group('follow','8. リリース後の指の方向・右側への流れ',[
    fingerCheck,unknown('中指がゴールを向いているか','中指とゴールの位置は直接検出していないため、未評価です。'),
    measured('followSide','シュート側への流れ',followSide,followSide< -0.05?'リリース後の手首がシュート側と逆側へ流れる傾向です。':followSide>0.4?'リリース後の手首がシュート側へ大きく流れる傾向です。':'リリース後の横方向の流れは指定目標に近い範囲です。','手首の移動方向を読み取れる正面の場面が不足しています。',true)]);
  const checks=[dipCheck,faceCheck,armCheck,shoulderCheck,relaxCheck,baseCheck,holdCheck,followCheck];
  const evaluated=checks.filter(c=>c.status!=='unrated');const weight=evaluated.reduce((s,c)=>s+c.weight,0);
  const overall=weight?Math.round(evaluated.reduce((s,c)=>s+c.score*c.weight,0)/weight):UNRATED_SCORE;
  const issues=checks.flatMap(c=>c.parts.filter(p=>p.status!=='unrated'&&p.score<85).map(p=>({label:p.label,score:p.score,comment:p.comment,priority:['releaseHeight','noseDistance','backLean'].includes(p.key)?0:1}))).sort((a,b)=>a.priority-b.priority||a.score-b.score);
  return {version:CHECKPOINT_VERSION,checks,mandatory:[height,nose,back],overall,status:evaluated.length?'estimated':'unrated',evaluatedCount:evaluated.length,issues,notes:['利用者が指定した目標への参考スコアです。Good Form一致度とは別です。','全て姿勢推定または代用指標です。未評価の50点は仮置きで、総合点には含めません。','ボール、腰椎、中指、筋肉の緊張、手の接触を直接計測した結果ではありません。']};
}
function evaluateShoulderDepth(analysis) {
  const rows=(analysis.frames??[]).filter(f=>has(f.landmarks,11,12)&&finite(f.landmarks[11].z)&&finite(f.landmarks[12].z));
  if(!rows.length)return null;
  const f=rows.reduce((best,f)=>Math.abs(f.time-analysis.phases.release)<Math.abs(best.time-analysis.phases.release)?f:best);
  const aspect=analysis.aspect??1;
  const width=Math.hypot((f.landmarks[11].x-f.landmarks[12].x)*aspect,f.landmarks[11].y-f.landmarks[12].y);
  return width>0.02?(f.landmarks[11].z-f.landmarks[12].z)*aspect/width:null;
}
