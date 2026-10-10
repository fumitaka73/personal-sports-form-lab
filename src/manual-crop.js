import {cropTransform} from './bone-comparison-data.js';
export function safeCrop(c){return !!c&&[c.x,c.y,c.width,c.height].every(Number.isFinite)&&c.x>=0&&c.y>=0&&c.width>=.1&&c.height>=.1&&c.x+c.width<=1.000001&&c.y+c.height<=1.000001;}
export function dragCrop(a,b){const width=Math.max(.1,Math.abs(a.x-b.x)),height=Math.max(.1,Math.abs(a.y-b.y));return {x:Math.max(0,Math.min(Math.min(a.x,b.x),1-width)),y:Math.max(0,Math.min(Math.min(a.y,b.y),1-height)),width,height,reason:'手動で指定した人物範囲'};}
export function sourcePoint(px,py,sw,sh,width,height,mirror=false){const t=cropTransform({x:0,y:0,width:1,height:1},sw,sh,width,height),x=(px-t.dx)/t.width,y=(py-t.dy)/t.height;if(x<0||x>1||y<0||y>1)return null;return {x:mirror?1-x:x,y};}
// Pointer events cover touch and mouse. Crop is expressed in original video
// coordinates, so resizing and mirroring never change saved region identity.
export function mountManualCrop(side,{update,onChange}){
 const button=side.root.querySelector('[data-crop-edit]'),canvas=side.canvas;let start=null,activePointer=null;
 const point=e=>{const r=side.stage.getBoundingClientRect(),sw=side.video.videoWidth||side.analysis.aspect*480||480,sh=side.video.videoHeight||480;return sourcePoint(e.clientX-r.left,e.clientY-r.top,sw,sh,r.width,r.height,side.mirror);};
 const exit=()=>{side.selectingCrop=false;side.cropPreview=null;start=null;activePointer=null;canvas.style.touchAction='';button.textContent='人物の範囲を指で囲む';update();};
 button.onclick=()=>{if(side.selectingCrop){exit();return;}side.selectingCrop=true;canvas.style.touchAction='none';button.textContent='範囲指定をやめる';side.root.querySelector('.bone-crop-help').textContent='全体表示の人物を、頭から足までドラッグで囲んでください。拡大は比較表示だけに適用します。';update();};
 const down=e=>{if(!side.selectingCrop||activePointer!==null)return;const p=point(e);if(!p)return;e.preventDefault();start=p;activePointer=e.pointerId;canvas.setPointerCapture(e.pointerId);};
 const move=e=>{if(activePointer!==e.pointerId||!start)return;const p=point(e);if(!p)return;e.preventDefault();side.cropPreview=dragCrop(start,p);update();};
 const up=e=>{if(activePointer!==e.pointerId||!start)return;const p=point(e),distance=p?Math.hypot(p.x-start.x,p.y-start.y):0;const crop=p&&distance>.02?dragCrop(start,p):null;exit();if(crop&&safeCrop(crop)){side.crop=crop;side.manualCrop=true;onChange();update();}};
 const cancel=()=>exit();canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);
 return ()=>{canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);};
}
