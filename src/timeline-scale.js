export const MAX_TIMELINE_WIDTH=32768;
export const MAX_TIMELINE_SCALE=50000;
export function initialScale(items){const times=items.map(i=>i.time).filter(Number.isFinite).sort((a,b)=>a-b);let gap=Infinity;for(let i=1;i<times.length;i++)if(times[i]>times[i-1])gap=Math.min(gap,times[i]-times[i-1]);return Math.min(512,Math.max(24,Number.isFinite(gap)?48/gap:24));}
export function timelineGeometry(bounds,scale,anchor=bounds.start){
 const pixels=Math.max(1,Math.min(MAX_TIMELINE_SCALE,scale)),extent=Math.min(bounds.end-bounds.start,(MAX_TIMELINE_WIDTH-44)/pixels),origin=Math.max(bounds.start,Math.min(bounds.end-extent,anchor-extent/2));
 return {origin,end:origin+extent,scale:pixels,width:extent*pixels+44,x:time=>22+(time-origin)*pixels,time:x=>origin+(x-22)/pixels};
}
// Extreme sub-frame coincidences retain exact x coordinates: one hit box is
// shown at a time; previous/next still selects every underlying record.
export function spacedMarkers(items,geometry,start,end,selected){
 const sorted=items.filter(i=>i.time>=start&&i.time<=end).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id)),out=[];
 for(const item of sorted){const last=out.at(-1);if(last&&geometry.x(item.time)-geometry.x(last.time)<44-1e-7){if(item.id===selected)out[out.length-1]=item;}else out.push(item);}return out;
}
