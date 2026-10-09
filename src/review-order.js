export function reviewGroups(cases,sessionTargets=[]){
 const groups=new Map();for(const c of cases){const key=`${c.source.mode}:${c.source.recordId}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
 const date=g=>sessionTargets.find(s=>s.mode===g[0].source.mode&&s.recordId===g[0].source.recordId)?.createdAt??Math.min(...g.map(c=>c.createdAt));
 return [...groups.values()].map(g=>g.sort((a,b)=>(a.analysis.phases?.release??a.createdAt)-(b.analysis.phases?.release??b.createdAt)||(a.source.shotNumber??1)-(b.source.shotNumber??1))).sort((a,b)=>date(b)-date(a));
}
