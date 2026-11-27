import {createTissue} from './tissue.js?v=1.2-lite';
let tissue=null,a=null,bones=null,epoch=0;
function updateTargets(transforms){
  const t=tissue.target,rest=a.points;
  for(let i=0;i<rest.length/3;i++){
    const k=i*3;let x=0,y=0,z=0;
    for(let j=0;j<4;j++){
      const w=a.weights[i*4+j];if(!w)continue;
      const bone=a.joints[i*4+j],b=bones[bone],q=bone*7,
        vx=rest[k]-b[0],vy=rest[k+1]-b[1],vz=rest[k+2]-b[2],
        qx=transforms[q+3],qy=transforms[q+4],qz=transforms[q+5],qw=transforms[q+6],
        tx=2*(qy*vz-qz*vy),ty=2*(qz*vx-qx*vz),tz=2*(qx*vy-qy*vx);
      x+=w*(vx+qw*tx+qy*tz-qz*ty+transforms[q]);
      y+=w*(vy+qw*ty+qz*tx-qx*tz+transforms[q+1]);
      z+=w*(vz+qw*tz+qx*ty-qy*tx+transforms[q+2]);
    }
    t[k]=x;t[k+1]=y;t[k+2]=z;
  }
}
self.onmessage=e=>{
  try{
    const d=e.data;
    if(d.type==='init'){a=d.arrays;bones=d.bones;tissue=createTissue(a,d.restSkin);self.postMessage({type:'ready',samples:tissue.stats.samples});return;}
    if(!tissue)throw Error('Worker not initialised');
    if(d.type==='reset'){epoch=d.epoch;updateTargets(d.transforms);tissue.reset();return;}
    if(d.type!=='step')return;
    const begin=performance.now();if(d.epoch!==epoch){epoch=d.epoch;updateTargets(d.transforms);tissue.reset();}
    updateTargets(d.transforms);tissue.step(d.gravity,d.floor,d.presses);
    const p=tissue.p,t=tissue.target,offsets=new Float32Array(p.length/3*4);
    for(let i=0;i<p.length/3;i++){const k=i*3,j=i*4;offsets[j]=p[k]-t[k];offsets[j+1]=p[k+1]-t[k+1];offsets[j+2]=p[k+2]-t[k+2];}
    self.postMessage({type:'result',epoch:d.epoch,ms:performance.now()-begin,stats:{samples:tissue.stats.samples,contacts:tissue.stats.contacts,penetration:tissue.stats.penetration},offsets},[offsets.buffer]);
  }catch(err){self.postMessage({type:'error',message:err.message});}
};
