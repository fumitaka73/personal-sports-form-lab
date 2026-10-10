import {personCrop} from './bone-comparison-data.js';
// Decode a real frame rather than relying on Safari's metadata-only video poster.
export async function videoThumbnail(src,time=0,width=80,height=96,signal,frames=null){
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
 try{
  await new Promise((resolve,reject)=>{
   let seeking=false,requested=false;
   const finish=error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);video.onloadedmetadata=video.onloadeddata=video.onseeked=video.onerror=null;error?reject(error):resolve();};
   const abort=()=>finish(new Error('cancelled'));const timer=setTimeout(()=>finish(new Error('frame timeout')),4000);
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
   video.onerror=()=>finish(new Error('video unavailable'));
   const seek=()=>{if(requested||video.readyState<1)return;requested=true;const end=Number.isFinite(video.duration)?Math.max(0,video.duration-.05):time;const target=Math.min(Math.max(.001,time),end);seeking=Math.abs(video.currentTime-target)>.0001;if(seeking)video.currentTime=target;else if(video.readyState>=2)finish();};
   video.onloadedmetadata=seek;video.onloadeddata=()=>{seek();if(!seeking&&video.readyState>=2)finish();};video.onseeked=()=>{if(video.readyState>=2)finish();else seeking=false;};video.src=src;video.load();
  });
  if(!video.videoWidth||!video.videoHeight)throw new Error('no decoded frame');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','シュート動画のフレーム');
  const crop=Array.isArray(frames)?personCrop(frames.filter(f=>f&&Array.isArray(f.landmarks))):{x:0,y:0,width:1,height:1},sw=crop.width*video.videoWidth,sh=crop.height*video.videoHeight,scale=Math.min(width/sw,height/sh),w=sw*scale,h=sh*scale;canvas.getContext('2d').drawImage(video,crop.x*video.videoWidth,crop.y*video.videoHeight,sw,sh,(width-w)/2,(height-h)/2,w,h);canvas.dataset.crop=JSON.stringify(crop);canvas.dataset.zoom=(scale/Math.min(width/video.videoWidth,height/video.videoHeight)).toFixed(1);canvas.setAttribute('aria-label',frames?'基準フォーム動画の人物（保存姿勢から自動拡大。姿勢不足の場合は全体）':'シュート動画のフレーム');return canvas;
 }finally{video.pause();video.removeAttribute('src');video.load();}
}
