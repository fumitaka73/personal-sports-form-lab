// Lightweight local color/shape tracking, not a trained sports-ball classifier.
// Coordinates are normalized to the source image; radius is a fraction of image height.
export function detectBallCandidates(image) {
  const {width,height,data}=image, size=width*height;
  const mask=new Uint8Array(size), expanded=new Uint8Array(size);
  for(let i=0;i<size;i++){
    const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    const max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max?(max-min)/max:0;
    if(r>60&&g>25&&r>g*1.12&&g>b*1.1&&r>b*1.5&&sat>0.42)mask[i]=1;
  }
  // Bridge thin black seams, without filling large unobserved areas.
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;
    if(mask[i]||mask[i-1]||mask[i+1]||mask[i-width]||mask[i+width])expanded[i]=1;
  }
  const visited=new Uint8Array(size),queue=new Int32Array(size),candidates=[];
  for(let seed=0;seed<size;seed++){
    if(!expanded[seed]||visited[seed])continue;
    let head=0,tail=1,minX=width,maxX=0,minY=height,maxY=0,sumX=0,sumY=0,original=0;
    queue[0]=seed;visited[seed]=1;
    while(head<tail){
      const i=queue[head++],x=i%width,y=Math.floor(i/width);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sumX+=x;sumY+=y;original+=mask[i];
      const neighbors=[];if(x>0)neighbors.push(i-1);if(x<width-1)neighbors.push(i+1);if(y>0)neighbors.push(i-width);if(y<height-1)neighbors.push(i+width);
      for(const n of neighbors)if(expanded[n]&&!visited[n]){visited[n]=1;queue[tail++]=n;}
    }
    const w=maxX-minX+1,h=maxY-minY+1,ratio=w/h,fill=tail/(w*h);
    if(original<12||w<5||h<5||w>width*0.3||h>height*0.3||ratio<0.6||ratio>1.65||fill<0.45||fill>0.93)continue;
    const confidence=Math.max(0,Math.min(1,0.65+0.25*(1-Math.abs(1-ratio))-0.6*Math.abs(fill-0.78)));
    candidates.push({x:sumX/tail/width,y:sumY/tail/height,radius:(w+h)/4/height,confidence,source:'orange-round-region'});
  }
  return candidates.sort((a,b)=>b.confidence-a.confidence);
}
const pointVisible=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??0)>=0.2;
export class BallTracker {
  constructor(aspect=1){this.aspect=aspect;this.history=[];this.last=null;this.previous=null;this.trackId=0;}
  update(candidates,landmarks,time,hand='right'){
    const wrist=landmarks?.[hand==='right'?16:15];
    const shoulder=landmarks?.[hand==='right'?12:11],hip=landmarks?.[hand==='right'?24:23];
    const torso=pointVisible(shoulder)&&pointVisible(hip)?Math.hypot((shoulder.x-hip.x)*this.aspect,shoulder.y-hip.y):0.25;
    let best=null,bestCost=Infinity;
    const continuing=this.last&&time-this.last.time<=0.3;
    for(const c of candidates){
      if(c.confidence<0.45)continue;
      let cost;
      if(continuing){
        const elapsed=time-this.last.time;
        const dt=this.previous?this.last.time-this.previous.time:0;
        const velocityX=dt>0?(this.last.x-this.previous.x)/dt:0,velocityY=dt>0?(this.last.y-this.previous.y)/dt:0;
        const prediction={x:this.last.x+velocityX*elapsed,y:this.last.y+velocityY*elapsed};
        const distance=Math.hypot((c.x-prediction.x)*this.aspect,c.y-prediction.y);
        const sizeChange=Math.abs(Math.log(c.radius/this.last.radius));
        const gate=Math.max(0.06,this.last.radius*5)+Math.min(0.18,elapsed*0.6);
        if(distance>gate||sizeChange>0.9)continue;
        cost=distance+sizeChange*0.04+(1-c.confidence)*0.03;
      }else{
        // Acquire near the shooting hand, never invent a ball when it is missing.
        if(!pointVisible(wrist))continue;
        const distance=Math.hypot((c.x-wrist.x)*this.aspect,c.y-wrist.y);
        if(distance>Math.max(c.radius*4,torso*0.65)||c.radius>torso*0.5)continue;
        cost=distance+(1-c.confidence)*0.08;
      }
      if(cost<bestCost){best=c;bestCost=cost;}
    }
    if(!best)return null;
    if(!continuing){this.trackId++;this.previous=null;}else this.previous=this.last;
    const ball={...best,time,trackId:this.trackId};this.last=ball;this.history.push(ball);return ball;
  }
}
