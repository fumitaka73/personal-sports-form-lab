import {detectBallCandidates,BallTracker} from './ball-tracking.js';
import {videoTransform} from './pose-coordinates.js';
import {validHoop} from './shot-outcome.js';
export function previewPoint(video,rect,clientX,clientY,mirror=false){
 const t=videoTransform(video.videoWidth,video.videoHeight,rect.width,rect.height,mirror),px=(clientX-rect.left-(rect.width-t.width)/2)/t.width,py=(clientY-rect.top-(rect.height-t.height)/2)/t.height;
 if(px<0||px>1||py<0||py>1)return null;
 return {x:mirror?1-px:px,y:py};
}
export function hoopFromCorners(a,b){const h={x:(a.x+b.x)/2,y:(a.y+b.y)/2,width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y),source:'manual'};return validHoop(h)?h:null;}
export class LiveBallSampler{
 constructor(){this.reset();this.enabled=false;}
 reset(aspect=1){this.tracker=new BallTracker(aspect);this.lastAt=-Infinity;this.ball=null;this.interval=200;this.slow=0;}
 sample(image,landmarks,time,hand='right',elapsed=0){
  this.lastAt=time;this.ball=this.tracker.update(detectBallCandidates(image),landmarks,time/1000,hand);this.tracker.history=this.tracker.history.slice(-2);
  if(elapsed>20&&++this.slow>=3)this.interval=500;
  return this.ball;
 }
 current(now){return this.enabled&&now-this.lastAt<=Math.min(250,this.interval+50)?this.ball:null;}
}
export function drawObjects(canvas,video,{ball=null,hoop=null,corner=null,mirror=false}={}){
 if(!video.videoWidth||!canvas.width)return;const rect=video.getBoundingClientRect(),dpr=Math.min(globalThis.devicePixelRatio||1,2),ctx=canvas.getContext('2d'),t=videoTransform(video.videoWidth,video.videoHeight,rect.width,rect.height,mirror);
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.lineWidth=3;ctx.setLineDash([]);
 if(ball){ctx.strokeStyle='#ffbc40';ctx.beginPath();ctx.ellipse(t.x(ball),t.y(ball),ball.radius*t.height,ball.radius*t.height,0,0,Math.PI*2);ctx.stroke();}
 if(hoop){ctx.strokeStyle=hoop.confirmed===false?'#ffbf47':'#61e9ff';ctx.setLineDash(hoop.confirmed===false?[6,4]:[]);const a={x:hoop.x-hoop.width/2,y:hoop.y-hoop.height/2},b={x:hoop.x+hoop.width/2,y:hoop.y+hoop.height/2};ctx.strokeRect(Math.min(t.x(a),t.x(b)),t.y(a),hoop.width*t.width,hoop.height*t.height);ctx.setLineDash([]);}
 if(corner){ctx.fillStyle='#61e9ff';ctx.beginPath();ctx.arc(t.x(corner),t.y(corner),5,0,Math.PI*2);ctx.fill();}
}
