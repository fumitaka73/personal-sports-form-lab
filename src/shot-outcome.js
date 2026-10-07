export function validHoop(h){return h&&[h.x,h.y,h.width,h.height].every(Number.isFinite)&&h.width>=.01&&h.height>=.003&&h.x-h.width/2>=0&&h.x+h.width/2<=1&&h.y-h.height/2>=0&&h.y+h.height/2<=1;}
export function classifyOutcome(points,hoop,release){
  if(!validHoop(hoop))return {status:'not-applicable',label:'成否判定なし',reason:'ゴール位置が指定されていないため、フォームのみ分析します。'};
  const unknown=reason=>({status:'unknown',label:'判定不能',reason});
  const path=points.filter(p=>p.time>=release&&p.time<=release+4).sort((a,b)=>a.time-b.time);
  for(let i=1;i<path.length-1;i++){
    const a=path[i-1],b=path[i];
    // Low-frame-rate uploads can repeat pixels at 24fps; look ahead to the
    // next observed lower position, while requiring continuity through every sample.
    const after=path.slice(i+1,i+6);
    const lowerIndex=after.findIndex(p=>p.time-b.time<=.25&&p.y>b.y&&p.y>hoop.y+hoop.height/2);
    if(lowerIndex<0)continue;
    const c=after[lowerIndex],continuous=[a,b,...after.slice(0,lowerIndex+1)];
    if(continuous.some((p,j)=>p.trackId!==a.trackId||(j&&p.time-continuous[j-1].time>.15)))continue;
    // Require observed descent across the rim plane and below it. Never bridge occlusion.
    if(!(a.y<hoop.y&&b.y>=hoop.y&&c.y>b.y&&c.y>hoop.y+hoop.height/2))continue;
    if(Math.abs(a.x-hoop.x)>hoop.width*2||Math.abs(b.x-hoop.x)>hoop.width*2)continue;
    const t=(hoop.y-a.y)/(b.y-a.y),x=a.x+t*(b.x-a.x),radius=Math.max(a.radius,b.radius);
    const inside=Math.abs(x-hoop.x)+radius<hoop.width/2;
    const outside=Math.abs(x-hoop.x)-radius>hoop.width/2+hoop.width*.15;
    if(!inside&&!outside)return unknown('ボールがリングの縁付近を通り、成功・失敗を区別できません。');
    return {status:inside?'likely-made':'likely-missed',label:inside?'成功の可能性（推定）':'失敗の可能性（推定）',confidence:'Low',crossingTime:a.time+t*(b.time-a.time),reason:inside?'連続するボール候補が、リング内側を上から下に通過しました。2D映像では奥行きを確認できず、成功確定ではありません。':'連続するボール候補が、リングの横を下降して通過しました。2D軌道に基づく参考判定です。'};
  }
  return unknown('ゴール周辺で連続した下降軌道を確認できませんでした。見失い・遮蔽・映像の終了などが考えられます。');
}
