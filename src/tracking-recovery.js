// Timed presence continuity, not facial/person identity recognition.
export class TrackingRecovery {
 constructor({lostAfter=1,stableAfter=.5}={}){this.lostAfter=lostAfter;this.stableAfter=stableAfter;this.reset();}
 reset(){this.seen=false;this.missingSince=null;this.stableSince=null;this.last=null;this.armed=false;this.ready=false;}
 update(time,valid,stable=valid){if(!Number.isFinite(time))return {ready:false,resumed:false};
  if(this.last!==null&&time<this.last)this.reset();
  if(this.last!==null&&time-this.last>.35){this.stableSince=null;this.missingSince??=this.last+.35;this.ready=false;}
  this.last=time;
  if(!valid){this.ready=false;this.stableSince=null;this.missingSince??=time;if(this.seen&&time-this.missingSince>=this.lostAfter)this.armed=true;return {ready:false,resumed:false};}
  if(this.seen&&this.missingSince!==null&&time-this.missingSince>=this.lostAfter)this.armed=true;
  this.missingSince=null;if(!stable){this.stableSince=null;this.ready=false;return {ready:false,resumed:false};}this.stableSince??=time;this.ready=time-this.stableSince>=this.stableAfter-1e-5;
  const resumed=this.ready&&this.seen&&this.armed;if(this.ready){this.seen=true;this.armed=false;}return {ready:this.ready,resumed};
 }
}
