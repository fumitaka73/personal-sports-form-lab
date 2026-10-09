// Original color/shape prototype; no learned model, external images or API.
// Returns a candidate only. Human confirmation is always required.
export function detectHoopCandidate({data,width,height}){
 const mask=new Uint8Array(width*height),seen=new Uint8Array(mask.length);
 for(let i=0;i<mask.length;i++){const r=data[i*4],g=data[i*4+1],b=data[i*4+2];mask[i]=r>105&&r>g*1.25&&r>b*1.6&&g<180?1:0;}
 let best=null,score=0;
 for(let i=0;i<mask.length;i++){if(!mask[i]||seen[i])continue;const stack=[i];seen[i]=1;let minX=width,maxX=0,minY=height,maxY=0,count=0;
  while(stack.length){const p=stack.pop(),x=p%width,y=Math.floor(p/width);count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(const n of [x? p-1:-1,x<width-1?p+1:-1,y?p-width:-1,y<height-1?p+width:-1])if(n>=0&&mask[n]&&!seen[n]){seen[n]=1;stack.push(n);}}
  const w=maxX-minX+1,h=maxY-minY+1,ratio=w/h,fill=count/(w*h);
  if(w<10||w>width*.65||h<2||ratio<2.5||ratio>15||fill<.12||fill>.9||maxY>height*.85)continue;
  const quality=w*(1-Math.abs(fill-.45));if(quality>score){score=quality;best={x:(minX+maxX+1)/2/width,y:(minY+maxY+1)/2/height,width:w/width,height:h/height,source:'color-shape',confirmed:false};}
 }
 return best;
}
export class HoopScan{
 constructor(){this.reset();}
 reset(now=0){this.remaining=3;this.lastAt=now-1000;this.stopped=false;}
 due(now){return !this.stopped&&this.remaining>0&&now-this.lastAt>=1000;}
 sample(image,now){this.lastAt=now;this.remaining--;const candidate=detectHoopCandidate(image);if(candidate)this.stopped=true;return candidate;}
 confirm(){this.stopped=true;this.remaining=0;}
}
