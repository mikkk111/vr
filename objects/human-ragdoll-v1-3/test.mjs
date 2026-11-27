import * as THREE from 'three';
import initJolt from 'jolt-physics';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRagdoll,rayHull} from './ragdoll.js';
const fit=JSON.parse(readFileSync(new URL('./fit.json',import.meta.url),'utf8'));
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),Q=()=>new THREE.Quaternion(),g=V(0,-9.81,0),h=1/120;
const report={engine:'Jolt WASM native rigid bodies; Node numerical regression, not Quest',fit:fit.fit,tests:[],passed:false};
function assert(x,msg){if(!x)throw Error(msg);}
try{
  const J=await initJolt();const m=createRagdoll(J,fit);
  m.setFloor(V(0,-1.27,0),Q(),g);m.wake();
  let maxGap=0,maxRootY=-Infinity,peakSpeed=0,lateSpeed=0,peakInterpenetration=0,previous=m.positions.map(p=>p.clone());
  const check=()=>{for(let i=0;i<m.positions.length;i++){const p=m.positions[i],q=m.rotations[i];assert(Number.isFinite(p.lengthSq()+q.lengthSq()),'Nonfinite pose');if(i===0)continue;
      const s=fit.shapes[i],par=s.parent,offset=m.rest[s.root].clone().sub(m.rest[fit.shapes[par].root]),expected=offset.applyQuaternion(m.rotations[par]).add(m.positions[par]);maxGap=Math.max(maxGap,p.distanceTo(expected));}};
  // Rest pose selection from in front of a wrist. Actual exact convex hull ray.
  const wrist=fit.shapes.findIndex(s=>s.name==='RightHand'),w=m.positions[wrist].clone(),r=new THREE.Ray(w.clone().add(V(.018,-.07,.7)),V(0,0,-1)),hit=m.pick(r,.01);
  assert(hit?.index===wrist,'Wrist ray selected '+hit?.index+' rather than '+wrist);
  const impulse=new J.Vec3(.12,0,1.8);m.bi.AddImpulse(m.bodies[1].GetID(),impulse);J.destroy(impulse);
  const begin=performance.now();
  for(let k=0;k<600;k++){
    m.step(h);check();maxRootY=Math.max(maxRootY,m.positions[0].y);
    for(let i=0;i<m.positions.length;i++){const speed=m.positions[i].distanceTo(previous[i])/h;peakSpeed=Math.max(peakSpeed,speed);if(k>=480)lateSpeed=Math.max(lateSpeed,speed);previous[i].copy(m.positions[i]);}
    if(k%12===0){
      // Sample transformed convex vertices against other convex halfspaces.
      // Exclude direct joints, where envelopes intentionally overlap.
      for(let i=0;i<fit.shapes.length;i++)for(let j=0;j<fit.shapes.length;j++){if(i===j||fit.shapes[i].parent===j||fit.shapes[j].parent===i)continue;
        if(m.positions[i].distanceTo(m.positions[j])>.85)continue;
        const inv=m.rotations[j].clone().invert();
        for(const v of fit.shapes[i].vertices){const p=V(...v).applyQuaternion(m.rotations[i]).add(m.positions[i]).sub(m.positions[j]).applyQuaternion(inv);let d=-Infinity;for(const [x,y,z,c] of fit.shapes[j].planes){d=Math.max(d,x*p.x+y*p.y+z*p.z+c);if(d>=0)break;}if(d<0)peakInterpenetration=Math.max(peakInterpenetration,-d);}
      }
    }
  }
  const drop={name:'5-second full rigid articulated drop',elapsedMs:performance.now()-begin,maxJointGapM:maxGap,peakOriginSpeedMps:peakSpeed,lateSpeedMps:lateSpeed,rootY:m.positions[0].y,maxRootY,peakSampledHullVertexDepthM:peakInterpenetration};
  report.tests.push(drop);
  assert(maxGap<.065,'Joint separation above 65 mm');assert(m.positions[0].y<-.3,'Pelvis did not fall');assert(lateSpeed<2,'Body did not settle');assert(peakInterpenetration<.035,'Sampled nonadjacent hull penetration exceeds 35 mm');
  // In zero gravity, move an actual wrist via same grab force as browser.
  m.reset();m.setFloor(V(0,-10,0),Q(),V());m.wake();
  const start=m.positions[wrist].clone(),initial=m.positions[0].clone(),offset=V(0,-.07,0),target=start.clone().add(offset).add(V(.25,.20,.25));
  for(let k=0;k<120;k++){m.grab(wrist,offset,target,V(),h);m.step(h);check();}
  const travel=m.positions[wrist].distanceTo(start),relative=m.positions[wrist].clone().sub(m.positions[0]).distanceTo(start.clone().sub(initial));
  report.tests.push({name:'1-second wrist grab in zero gravity',travelM:travel,relativeToPelvisTravelM:relative,maxJointGapM:maxGap});
  assert(travel>.08&&relative>.04,'Wrist failed to articulate');m.dispose();report.passed=true;
}catch(e){report.error=String(e?.stack||e);}
writeFileSync(new URL('./test-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
