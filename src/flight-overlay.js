import {videoTransform} from './pose-coordinates.js';
export function drawFlightOverlay(video,canvas,analysis){
 if(!canvas)return;const width=video.clientWidth,height=video.clientHeight;
 if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);
 if(!analysis||!video.videoWidth||video.hidden)return;
 const {width:vw,height:vh,x,y}=videoTransform(video.videoWidth,video.videoHeight,width,height);
 ctx.strokeStyle='#59e5f7';ctx.lineWidth=2;
 if(analysis.hoop){const h=analysis.hoop;ctx.strokeRect(x({x:h.x-h.width/2}),y({y:h.y-h.height/2}),h.width*vw,h.height*vh);}
 const points=analysis.flightTracking?.points??analysis.ballTracking?.points??[];
 const trail=points.filter(p=>p.time<=video.currentTime+.025&&p.time>=video.currentTime-.7);
 for(let i=1;i<trail.length;i++){const a=trail[i-1],b=trail[i];if(a.trackId!==b.trackId||b.time-a.time>.15)continue;ctx.beginPath();ctx.moveTo(x(a),y(a));ctx.lineTo(x(b),y(b));ctx.stroke();}
 const nearest=points.reduce((best,p)=>!best||Math.abs(p.time-video.currentTime)<Math.abs(best.time-video.currentTime)?p:best,null);
 if(nearest&&Math.abs(nearest.time-video.currentTime)<.08){ctx.beginPath();ctx.arc(x(nearest),y(nearest),nearest.radius*vh,0,2*Math.PI);ctx.stroke();}
}
