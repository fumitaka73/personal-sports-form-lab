// A fixed-width hit box per cluster prevents dense markers from overlapping.
export function markerGroups(items,bounds,width,minHit=44){
 if(!bounds||bounds.end<=bounds.start)return [];
 const lanes=Math.max(1,Math.floor(width/minHit)),groups=new Map();
 for(const item of [...items].sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id))){const slot=Math.max(0,Math.min(lanes-1,Math.floor((item.time-bounds.start)/(bounds.end-bounds.start)*lanes)));if(!groups.has(slot))groups.set(slot,[]);groups.get(slot).push(item);}
 return [...groups].map(([slot,items])=>({slot,items,left:slot*width/lanes,width:width/lanes}));
}
export function visibleMarkers(items,filter){return items.filter(i=>filter==='pending'?i.kind==='candidate'&&(!i.label||i.label==='later'):filter==='detected'?i.kind==='detected':true);}
export function adjacentMarker(items,selected,position,direction,pending=false){const sorted=[...items].filter(i=>!pending||!i.label||i.label==='later').sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id)),at=sorted.findIndex(i=>i.id===selected);return at>=0?sorted[at+direction]:direction<0?[...sorted].reverse().find(i=>i.time<position):sorted.find(i=>i.time>=position);}
