// Projected shoulder–hip–knee geometry. These are NOT lumbar or pelvic angles.
export const TRUNK_VERSION='trunk-proxy-1';
const finite=Number.isFinite,median=a=>{a=a.filter(finite).sort((a,b)=>a-b);return a.length?a[Math.floor(a.length/2)]:null;};
const visible=p=>p&&finite(p.x)&&finite(p.y)&&(p.visibility??0)>=.2;
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,visibility:Math.min(a.visibility,b.visibility)});
export function trunkFrame(frame,aspect=1){
 const p=frame.landmarks?.map(v=>({...v,x:v.x*(frame.aspect??aspect)}));if(!p)return null;
 const pair=(a,b)=>visible(p[a])&&visible(p[b])?mid(p[a],p[b]):visible(p[a])?p[a]:visible(p[b])?p[b]:null;
 const shoulder=pair(11,12),hip=pair(23,24),knee=pair(25,26);if(!shoulder||!hip||!knee)return null;
 const length=Math.hypot(shoulder.x-hip.x,shoulder.y-hip.y);if(length<.025||hip.y<=shoulder.y||Math.hypot(knee.x-hip.x,knee.y-hip.y)<.025)return null;
 const facing=visible(p[0])&&(Math.abs(p[0].x-shoulder.x)/length)>.06?Math.sign(p[0].x-shoulder.x):0;
 const lean=Math.atan2(facing?(hip.x-shoulder.x)*facing:Math.abs(hip.x-shoulder.x),hip.y-shoulder.y)*180/Math.PI;
 const a={x:shoulder.x-hip.x,y:shoulder.y-hip.y},b={x:knee.x-hip.x,y:knee.y-hip.y};
 const extension=Math.acos(Math.max(-1,Math.min(1,(a.x*b.x+a.y*b.y)/(length*Math.hypot(b.x,b.y)))))*180/Math.PI;
 const wrist=visible(p[16])?p[16]:visible(p[15])?p[15]:null;
 return {time:frame.time,lean,extension,facing,visibility:Math.min(shoulder.visibility,hip.visibility,knee.visibility),wrist:wrist?(shoulder.y-wrist.y)/length:null};
}
export function trunkProfile(frames,phases,aspect=1){
 if(!phases||!(phases.release>phases.start))return null;
 const raw=frames.filter(f=>f.time>=phases.start&&f.time<=phases.release).map(f=>trunkFrame(f,aspect));
 const valid=raw.filter(Boolean);if(!valid.length)return null;
 let left=0,right=0;const rows=valid.map(r=>{while(left<valid.length&&valid[left].time<r.time-.12)left++;while(right<valid.length&&valid[right].time<=r.time+.12)right++;const near=valid.slice(left,right);return {...r,lean:median(near.map(n=>n.lean)),extension:median(near.map(n=>n.extension)),phase:(r.time-phases.start)/(phases.release-phases.start)};});
 // Small immutable profile, retained when full analysis frames are compacted.
 return {version:TRUNK_VERSION,coverage:valid.length/Math.max(1,raw.length),duration:phases.release-phases.start,rows:rows.filter((r,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.floor(rows.length/40))===0).slice(0,80)};
}
export function referenceTrunk(analysis){return analysis?.trunkProfile??(analysis?.frames?trunkProfile(analysis.frames,analysis.phases,analysis.aspect):null);}
export function estimateTrunk(profile,reference,angle='side',referenceAngle=angle){
 const base={version:TRUNK_VERSION,method:'2D projected shoulder/hip/knee',confidence:'Low',status:'unavailable',alert:false,audioEligible:false,lean:null,extension:null,excess:null,changeExcess:null,persistentSeconds:0,reason:'N/A：肩・股関節・膝の時系列がありません。',profile};
 if(!profile?.rows.length)return base;
 const rows=profile.rows,release=rows.at(-1),start=median(rows.filter(r=>r.phase<=.2).map(r=>r.lean));
 const sufficient=rows.length>=3&&profile.coverage>=.75&&rows.every(r=>r.visibility>=.65&&r.facing!==0)&&new Set(rows.map(r=>r.facing)).size===1;
 const comparable=reference?.rows.length>=3&&reference.rows[0].phase<=.2&&reference.rows.at(-1).phase>=.8&&reference.coverage>=.75&&reference.rows.every(r=>r.visibility>=.65&&r.facing!==0)&&new Set(reference.rows.map(r=>r.facing)).size===1&&angle===referenceAngle;
 const fullPhase=rows[0].phase<=.2&&release.phase>=.8;const confidence=sufficient&&comparable&&fullPhase?(angle==='side'?'High':angle==='diagonal'?'Medium':'Low'):'Low';
 const refAt=phase=>reference?.rows?.reduce((best,r)=>!best||Math.abs(r.phase-phase)<Math.abs(best.phase-phase)?r:best,null);
 const refStart=median((reference?.rows??[]).filter(r=>r.phase<=.2).map(r=>r.lean));
 const samples=rows.map(r=>{const b=refAt(r.phase),excess=b&&Math.abs(b.phase-r.phase)<=.2?r.lean-b.lean:null,change=finite(start)&&finite(refStart)&&finite(excess)?excess-(start-refStart):null;return {...r,excess,change,hit:finite(excess)&&excess>=8&&r.lean>=10&&(change>=6||r.extension-b.extension>=8)};});
 let run=[],longest=[];for(const r of samples){if(!r.hit||run.length&&r.time-run.at(-1).time>.25)run=[];if(r.hit){run.push(r);if(run.length>=3&&r.time-run[0].time>=.12&&(!longest.length||r.time-run[0].time>longest.at(-1).time-longest[0].time))longest=[...run];}}
 const alert=!!longest.length,peak=longest.length?longest.reduce((a,b)=>a.excess>b.excess?a:b):samples.at(-1);
 return {...base,status:'estimated',confidence,lean:release.lean,extension:release.extension,excess:peak.excess,changeExcess:peak.change,persistentSeconds:longest.length?longest.at(-1).time-longest[0].time:0,alert,audioEligible:alert&&confidence!=='Low',reason:!comparable?'参考値：同じ条件のGood Form時系列が不足しています。':confidence==='Low'?'参考値：向き・可視性・フレーム数が不十分です。':alert?'同じ動作フェーズのGood Formより体幹後傾・伸展が増え、複数フレームで持続しました。':'比較できた範囲では、持続した大きな後傾・伸展差は見つかりません。'};
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function trunkHTML(t){const n=v=>finite(v)?v.toFixed(1)+'°':'N/A';return `<article class="trunk-card"><h3>腰の反らしすぎの可能性（代理指標）</h3><p>${t?.status==='estimated'?(t.alert?'腰反りすぎの可能性':'体幹の参考推定'):'N/A・この記録には推定なし'} · 推定信頼度 ${esc(t?.confidence??'Low')}</p><p>体幹後傾 ${n(t?.lean)} · Good Formとの差 ${n(t?.excess)}</p><p>${esc(t?.reason??'旧記録は再分析せず保持しています。')}</p><details><summary>推定の根拠と限界</summary><p>2Dの肩・股関節・膝の投影角度です。腰椎の湾曲・骨盤前傾・医学的な反り腰は計測しません。Highも診断の確度ではありません。斜め横は最大Medium、Lowは参考表示のみ。Form Matchに加点・減点しません。</p><p>構えからの変化差 ${n(t?.changeExcess)} · 持続 ${t?.persistentSeconds?.toFixed(2)??'—'}秒</p></details></article>`;}
