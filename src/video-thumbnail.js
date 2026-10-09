// Decode a real frame rather than relying on Safari's metadata-only video poster.
export async function videoThumbnail(src,time=0,width=80,height=96,signal){
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
  const scale=Math.min(width/video.videoWidth,height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;canvas.getContext('2d').drawImage(video,(width-w)/2,(height-h)/2,w,h);return canvas;
 }finally{video.pause();video.removeAttribute('src');video.load();}
}
