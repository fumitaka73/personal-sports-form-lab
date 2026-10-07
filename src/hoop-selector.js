import {validHoop} from './shot-outcome.js';
// User confirms a visible rim; absence of a color candidate never establishes absence of a hoop.
export function mountHoopSelector(container,video,initial=null){
 container.innerHTML='<details><summary>ゴールが映る場合の成否推定（任意）</summary><label><input type="checkbox" class="hoop-visible"> ゴールが映っている・位置を指定する</label><p>ゴールが映る位置で動画を止め、「位置を指定」を押してください。画像上でリングを囲む左上・右下の2点をクリックします。カメラ固定の動画向けです。指定しなければフォームのみ分析します。</p><button type="button" class="secondary hoop-select">位置を指定</button><canvas class="hoop-canvas" hidden></canvas><p class="hoop-label" role="status"></p></details>';
 const check=container.querySelector('.hoop-visible'),button=container.querySelector('button'),canvas=container.querySelector('canvas'),label=container.querySelector('.hoop-label');let hoop=validHoop(initial)?initial:null,corner=null;
 check.checked=!!hoop;
 const report=()=>label.textContent=check.checked?(hoop?'ゴール位置を指定済み。成否はボール軌道から推定します。':'ゴール位置は未指定です。フォーム分析だけを行います。'):'成否判定なし・フォームのみ';report();
 check.onchange=()=>{canvas.hidden=true;corner=null;report();};
 button.onclick=()=>{if(video.readyState<2){label.textContent='先に動画を選んでください。';return;}video.pause();check.checked=true;canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);canvas.hidden=false;corner=null;label.textContent='リングを囲む左上・右下の2点をクリックしてください。';};
 canvas.onclick=event=>{const rect=canvas.getBoundingClientRect(),p={x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};if(!corner){corner=p;label.textContent='反対側の角をクリックしてください。';return;}
  const candidate={x:(corner.x+p.x)/2,y:(corner.y+p.y)/2,width:Math.abs(p.x-corner.x),height:Math.abs(p.y-corner.y)};corner=null;
  if(!validHoop(candidate)){label.textContent='リング全体を囲むように、もう一度2点を指定してください。';return;}
  hoop=candidate;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);ctx.strokeStyle='#59e5f7';ctx.lineWidth=Math.max(2,canvas.width/300);ctx.strokeRect((hoop.x-hoop.width/2)*canvas.width,(hoop.y-hoop.height/2)*canvas.height,hoop.width*canvas.width,hoop.height*canvas.height);report();
 };
 return {value:()=>check.checked&&validHoop(hoop)?hoop:null,reset:value=>{hoop=validHoop(value)?value:null;check.checked=!!hoop;canvas.hidden=true;report();}};
}
