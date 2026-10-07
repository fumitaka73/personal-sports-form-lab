// Bound playback to one detected window. The original session Blob is reused.
export function setupShotPlayback(player, seek, onLabel, onError, onFrame=()=>{}) {
  let selected=null, disposed=false, sequence=0, selecting=false, raf;
  const bound=()=>{
    if(!selected||selecting||disposed)return;
    if(player.currentTime>=selected.end){player.pause();if(player.currentTime>selected.end+0.01)player.currentTime=selected.end;}
    else if(player.currentTime<selected.start-0.01)player.currentTime=selected.start;
  };
  const tick=()=>{bound();onFrame(player,selected);if(!disposed)raf=requestAnimationFrame(tick);};
  const play=()=>{
    if(selected&&!selecting&&(player.currentTime>=selected.end-0.02||player.currentTime<selected.start)){
      player.pause();void select(selected,true);
    }
  };
  async function select(shot, autoplay=true, releaseOnly=false){
    const id=++sequence;player.pause();selected=shot;selecting=true;player.hidden=false;onLabel(shot);
    try{
      if(player.readyState<2)await new Promise((resolve,reject)=>{
        const finish=error=>{clearTimeout(timeout);player.removeEventListener('loadeddata',ready);player.removeEventListener('error',failed);error?reject(error):resolve();};
        const ready=()=>finish(),failed=()=>finish(new Error('動画を読み込めませんでした。'));
        const timeout=setTimeout(()=>finish(new Error('動画の読み込みがタイムアウトしました。')),10000);
        player.addEventListener('loadeddata',ready);player.addEventListener('error',failed);
      });
      if(disposed||id!==sequence)return;
      await seek(player,releaseOnly?shot.release:shot.start);
      if(disposed||id!==sequence)return;
      selecting=false;
      if(autoplay)await player.play();
    }catch(error){if(!disposed&&id===sequence)onError(error);}
    finally{if(id===sequence)selecting=false;}
  }
  player.addEventListener('timeupdate',bound);player.addEventListener('seeked',bound);player.addEventListener('play',play);tick();
  return {
    select,
    replay:()=>selected?select(selected):Promise.resolve(),
    release:()=>selected?select(selected,false,true):Promise.resolve(),
    dispose:()=>{disposed=true;++sequence;player.pause();cancelAnimationFrame(raf);player.removeEventListener('timeupdate',bound);player.removeEventListener('seeked',bound);player.removeEventListener('play',play);}
  };
}
