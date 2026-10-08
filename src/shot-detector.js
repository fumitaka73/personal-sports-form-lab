import {detectSessionShots,SESSION_POSE_THRESHOLDS} from './session.js';
import {shotMotionRows,motionSignals} from './auto-phases.js';
import {liveMetrics} from './live-metrics.js';
// Incremental adapter around the existing Session detector, not a new classifier.
// Timestamp is milliseconds, matching camera/performance timestamps.
export class ShotDetector{
 constructor({hand='right',aspect=1,live=false,range=null,parameters=SESSION_POSE_THRESHOLDS}={}){this.parameters={...SESSION_POSE_THRESHOLDS,...parameters};this.hand=hand;this.aspect=aspect;this.live=live;this.range=range;this.frames=[];this.history=[];this.count=0;this.lastRelease=-Infinity;this.lastEvaluation=-Infinity;this.previous=null;this.preparation=null;this.lastEvent=null;this.state='IDLE';this.signals={};}
 processFrame(timestamp,landmarks,ball=null,frameTime=null){
  this.completed=[];const time=frameTime??timestamp/1000;if(!Number.isFinite(time)||this.frames.at(-1)?.time>=time)return this.snapshot();
  const frame={time,landmarks,ball};this.frames.push(frame);
  if(!this.live)return this.snapshot();
  this.frames=this.frames.filter(f=>f.time>=time-10);
  const row=shotMotionRows([frame],this.hand,this.aspect)[0]??null;
  const motion=motionSignals(this.previous,row,.6),wristVelocity=motion.wristVelocity,elbowVelocity=motion.elbowVelocity;
  this.signals={wristHeight:row?.wristHeight??null,wristVelocity,elbowAngle:row?.elbow??null,elbowVelocity,kneeAngle:liveMetrics(landmarks,this.aspect)[this.hand==='right'?'rightKnee':'leftKnee'],shoulderToWrist:row?(row.wristHeight>=0?'above':'below'):null};
  this.history.push({time,...this.signals});this.history=this.history.filter(r=>r.time>=time-10);
  if(!row){this.previous=null;this.preparation=null;this.state='IDLE';return this.snapshot();}
  // These are diagnostic gates from Session, not an independent shot decision.
  if(row.wristHeight<=this.parameters.prepHeight&&row.elbow<=this.parameters.prepElbow){this.preparation=row;this.state='DIP';}
  if(motion.qualifies)this.state='RISING';
  const ready=this.preparation;
  if(ready&&row.wristHeight>=this.parameters.peakHeight&&row.wristHeight-ready.wristHeight>=this.parameters.minRise&&row.elbow>=this.parameters.minExtendedElbow&&row.elbow-ready.elbow>=this.parameters.minExtension)this.state='RELEASE_CANDIDATE';
  if(time-this.lastEvaluation>=.25){
   this.lastEvaluation=time;
   const candidates=this.detect({start:this.frames[0].time,end:time});
   for(const candidate of candidates){
    const release=candidate.phases.release;
    if(release-this.lastRelease<1.5)continue;
    this.state='FOLLOW_THROUGH';
    // Wait for the detector's existing 0.8s post-release evidence window.
    if(time-release<.8)continue;
    this.count++;this.lastRelease=release;this.lastEvent={number:this.count,at:time,...candidate};this.completed.push(this.lastEvent);this.preparation=null;this.state='COMPLETE';
   }
  }
  if(this.lastEvent&&time-this.lastEvent.at<.4)this.state='COMPLETE';
  else if(this.lastEvent&&row.wristHeight>.4&&time-this.lastEvent.at<3)this.state='FOLLOW_THROUGH';
  this.previous=row;return this.snapshot();
 }
 detect(range=this.range){if(!this.frames.length)return [];return detectSessionShots(this.frames,this.hand,this.aspect,range??{start:this.frames[0].time,end:this.frames.at(-1).time},this.parameters);}
 snapshot(){return {state:this.state,count:this.count,signals:this.signals,event:this.lastEvent,events:this.completed??[]};}
}
export function detectSessionWithAdapter(frames,hand,aspect,range){
 const detector=new ShotDetector({hand,aspect,range});
 for(const frame of frames)detector.processFrame(frame.time*1000,frame.landmarks,frame.ball,frame.time);
 return detector.detect();
}
