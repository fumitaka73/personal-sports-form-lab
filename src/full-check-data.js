// All coordinates are absolute session seconds. No media or analysis is copied.
export function mergeRanges(ranges,bounds,tolerance=.05){
 const sorted=ranges.filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start).map(r=>({start:Math.max(bounds.start,r.start),end:Math.min(bounds.end,r.end)})).filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start),out=[];
 for(const r of sorted){const last=out.at(-1);if(last&&r.start<=last.end+tolerance)last.end=Math.max(last.end,r.end);else out.push(r);}return out;
}
export function fullProgress(old={},position,watched,bounds,confirm=false,now=Date.now()){
 if(!bounds||!Number.isFinite(position))throw new Error('練習内の位置を選んでください。');
 const seen=mergeRanges([...(old.watched??[]),...watched],bounds),confirmed=mergeRanges([...(old.confirmed??[]),...(confirm?seen:[])],bounds);
 const complete=confirmed.length===1&&confirmed[0].start<=bounds.start+.1&&confirmed[0].end>=bounds.end-.1;
 return {...old,position:Math.max(bounds.start,Math.min(bounds.end,position)),watched:confirm?[]:seen,confirmed,completedAt:complete?(old.completedAt??now):null,updatedAt:now};
}
export function markerKind(item){return item.label==='no'?'rejected':item.kind==='manual'||item.kind==='candidate'&&item.label==='yes'?'manual':item.kind==='candidate'?'candidate':'detected';}
export const markerNames={detected:'● 自動検出',candidate:'▲ 未検出候補',manual:'◆ 追加済み',rejected:'× 誤検出・除外'};
export function coverage(rows,bounds){return mergeRanges(rows.filter(r=>r.kind!=='shot-clip'&&r.blob?.size!==0).map(r=>({start:r.start,end:r.decodedEnd??r.end})),bounds,0);}
