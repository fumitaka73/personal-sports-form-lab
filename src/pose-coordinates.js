export const POSE_CONNECTIONS=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
export function videoTransform(sourceWidth,sourceHeight,width,height,mirror=false,fit='contain'){
 const scale=(fit==='cover'?Math.max:Math.min)(width/sourceWidth,height/sourceHeight);
 const vw=sourceWidth*scale,vh=sourceHeight*scale;
 return {width:vw,height:vh,x:p=>(width-vw)/2+(mirror?1-p.x:p.x)*vw,y:p=>(height-vh)/2+p.y*vh,scale};
}
export function drawPose(canvas,video,landmarks,mirror=false){
 const rect=video.getBoundingClientRect(),dpr=Math.min(globalThis.devicePixelRatio||1,2);
 if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);}
 const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
 if(!landmarks||!video.videoWidth||!rect.width||!rect.height)return;
 const {x,y}=videoTransform(video.videoWidth,video.videoHeight,rect.width,rect.height,mirror);
 ctx.lineWidth=2;ctx.strokeStyle='#daf571';
 for(const [a,b]of POSE_CONNECTIONS){const p=landmarks[a],q=landmarks[b];if((p?.visibility??0)<.2||(q?.visibility??0)<.2)continue;ctx.setLineDash(Math.min(p.visibility,q.visibility)<.55?[4,4]:[]);ctx.beginPath();ctx.moveTo(x(p),y(p));ctx.lineTo(x(q),y(q));ctx.stroke();}
 ctx.setLineDash([]);
 for(const p of landmarks.slice(11,29)){if((p.visibility??0)<.2)continue;ctx.fillStyle=p.visibility<.55?'#e7b258':'#daf571';ctx.beginPath();ctx.arc(x(p),y(p),p.visibility<.55?2:3,0,2*Math.PI);ctx.fill();}
}
