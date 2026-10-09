import assert from 'node:assert/strict';
import {detectHoopCandidate,HoopScan} from '../src/hoop-candidate.js';
const image=()=>({width:160,height:120,data:new Uint8ClampedArray(160*120*4)});
function pixel(im,x,y){im.data.set([220,85,20,255],(y*im.width+x)*4);}
const ring=image();for(let y=20;y<30;y++)for(let x=45;x<85;x++){if(y<23||y>26||x<48||x>81)pixel(ring,x,y);}
const result=detectHoopCandidate(ring);assert.ok(result);assert.equal(result.confirmed,false);assert.equal(result.source,'color-shape');assert.ok(Math.abs(result.x-.40625)<.01);
assert.equal(detectHoopCandidate(image()),null);
const ball=image();for(let y=20;y<40;y++)for(let x=45;x<65;x++)if(Math.hypot(x-55,y-30)<10)pixel(ball,x,y);assert.equal(detectHoopCandidate(ball),null);
const solid=image();for(let y=20;y<30;y++)for(let x=45;x<85;x++)pixel(solid,x,y);assert.equal(detectHoopCandidate(solid),null);
const scan=new HoopScan();assert.ok(scan.due(0));scan.sample(image(),0);assert.equal(scan.due(999),false);assert.ok(scan.due(1000));scan.sample(image(),1000);scan.sample(image(),2000);assert.equal(scan.due(9999),false);scan.reset(10000);assert.ok(scan.due(10000));assert.ok(scan.sample(ring,10000));assert.equal(scan.due(11000),false);scan.reset();scan.confirm();assert.equal(scan.due(1000),false);
console.log('PASS Hoop candidate geometry, negatives, three bounded scans, re-scan and stop after candidate/confirmation');
