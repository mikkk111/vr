// Four bounded regional inertial spring handles; no added rigid bodies or
// forces on the tested ragdoll. Model coordinates are metres.
export const defaults={chest:1.25,hips:1.15,chestFirm:.55,hipFirm:.60,chestDamp:.34,hipDamp:.38,sag:1.15,contact:1.4,heft:1.0,bounce:.12};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const norm=(a)=>Math.hypot(...a);
export function springStep(state,acc,dt,region,settings,gravity=[0,0,0],contact=[0,0,0]){
  const chest=region.owner===1,gain=clamp(chest?settings.chest:settings.hips,0,3),f=chest?[4.0,2.9,3.6]:[4.8,3.8,4.3];
  const steps=Math.max(1,Math.ceil(dt*240)),h=dt/steps,damping=clamp(chest?settings.chestDamp:settings.hipDamp,.15,1.4),firmness=clamp(chest?settings.chestFirm:settings.hipFirm,.35,1.6);
  for(let k=0;k<steps;k++)for(let i=0;i<3;i++){
    const omega=2*Math.PI*f[i]*firmness,cap=region.bounds[i],x=state.x[i],v=state.v[i];
    const g=clamp(gravity[i]*settings.sag*gain,-28,28);
    const drive=clamp(-acc[i]*gain+g+contact[i]*gain,-85,85);
    const a=drive-2*damping*omega*v-omega*omega*x*(1+.9*(x/cap)**4);
    state.v[i]=clamp(v+a*h,-1.8,1.8);state.x[i]=clamp(x+state.v[i]*h,-cap,cap);
    if(Math.abs(state.x[i])>=cap&&state.x[i]*state.v[i]>0)state.v[i]=0;
  }
  if(gain===0){state.x.fill(0);state.v.fill(0);}
}
// Finite contact with an actual local surface plane. Relative controller
// velocity is measured in the same moving rigid-body frame as the region.
// A swept crossing is recognised even if the two samples skip the shell.
export function contactDrive(previous,current,surface,side,dt,radius,strength,state){
  const d0=side*(previous[2]-surface),d1=side*(current[2]-surface),speed=current.map((x,k)=>(x-previous[k])/dt);
  const near=d1<=radius&&d1>=-radius*1.2,swept=d0>radius&&d1<radius&&d1>=-radius*3;
  const active=near||swept;
  state.cool=Math.max(0,state.cool-dt);
  if(!active){state.active=false;return {force:[0,0,0],impulse:[0,0,0],active:false};}
  const entering=!state.active||swept;
  const inward=Math.max(0,-side*speed[2]),tangent=Math.hypot(speed[0],speed[1]);
  const penetration=clamp(radius-d1,0,radius);
  const force=[clamp(speed[0]*13,-22,22),clamp(speed[1]*13,-22,22),-side*clamp(penetration*380+inward*4,0,32)].map(x=>x*strength);
  let impulse=[0,0,0];
  if(state.cool===0&&((entering&&(inward>.10||tangent>.35))||(!entering&&tangent>1.05&&state.lastTangent<.65))){
    impulse=[clamp(speed[0]*.24,-.6,.6),clamp(speed[1]*.24,-.6,.6),-side*clamp(inward*.28,0,.85)].map(x=>x*strength);state.cool=.095;
  }
  state.lastTangent=tangent;state.active=true;return {force,impulse,active:true};
}
export function buildMasks(positions,joints,weights,fit){
  const n=positions.length/3,regions=fit.secondaryRegions,owner=new Int16Array(fit.names.length),dom=new Int16Array(n),masks=regions.map(()=>new Float32Array(n));
  fit.shapes.forEach((s,i)=>s.bones.forEach(k=>owner[k]=i));
  for(let i=0;i<n;i++){
    let max=-1,best=0;for(let j=0;j<4;j++)if(weights[i*4+j]>max){max=weights[i*4+j];best=joints[i*4+j];}dom[i]=owner[best];
    const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2];
    for(let r=0;r<regions.length;r++){
      const q=regions[r];if(dom[i]!==q.owner)continue;
      const d=Math.hypot((x-q.center[0])/q.radius[0],(y-q.center[1])/q.radius[1],(z-q.center[2])/q.radius[2]);if(d>=1)continue;
      let groupWeight=0;for(let j=0;j<4;j++)if(owner[joints[i*4+j]]===q.owner)groupWeight+=weights[i*4+j];
      const t=1-d;masks[r][i]=t*t*(3-2*t)*clamp((groupWeight-.65)/.35,0,1);
    }
    const s=fit.shapes[dom[i]],rest=fit.rest[s.root];let ratio=1;
    if(masks.some(m=>m[i]>0))for(const [a,b,c,d] of s.planes){
      let reach=0;for(let r=0;r<regions.length;r++)if(masks[r][i]){const cap=regions[r].bounds;reach+=masks[r][i]*(Math.abs(a)*cap[0]+Math.abs(b)*cap[1]+Math.abs(c)*cap[2]);}
      if(reach>1e-12)ratio=Math.min(ratio,Math.max(0,-(a*(x-rest[0])+b*(y-rest[1])+c*(z-rest[2])+d)-.0001)/reach);
    }
    for(const m of masks)m[i]*=ratio;
  }
  return {masks,dom};
}
// Fit a tangent-plane gradient of the actual mask to neighbouring vertices.
// Calculated only once, preserving the authored normals and UV seams.
function makeRows(pos,normal,index,masks){
  const n=pos.length/3,rows=[],map=new Int32Array(n).fill(-1);
  for(let i=0;i<n;i++)if(masks.some(m=>m[i]>1e-7)){
    const k=i*3,nx=normal[k],ny=normal[k+1],nz=normal[k+2];let tx=0,ty=-nz,tz=ny;
    if(Math.abs(nx)>.8){tx=-ny;ty=nx;tz=0;}const d=Math.hypot(tx,ty,tz)||1;tx/=d;ty/=d;tz/=d;
    const ux=ny*tz-nz*ty,uy=nz*tx-nx*tz,uz=nx*ty-ny*tx;
    map[i]=rows.length;rows.push({i,k,tx,ty,tz,ux,uy,uz,a:0,b:0,c:0,m:masks.map(m=>m[i]),r:masks.map(()=>[0,0]),g:[]});
  }
  function edge(i,j){const at=map[i];if(at<0||i===j)return;const r=rows[at],k=j*3,x=pos[k]-pos[r.k],y=pos[k+1]-pos[r.k+1],z=pos[k+2]-pos[r.k+2],s=x*r.tx+y*r.ty+z*r.tz,t=x*r.ux+y*r.uy+z*r.uz,weight=1/Math.max(1e-6,x*x+y*y+z*z);r.a+=s*s*weight;r.b+=s*t*weight;r.c+=t*t*weight;for(let q=0;q<masks.length;q++){const dw=masks[q][j]-r.m[q];r.r[q][0]+=s*dw*weight;r.r[q][1]+=t*dw*weight;}}
  for(let k=0;k<index.length;k+=3){const a=index[k],b=index[k+1],c=index[k+2];edge(a,b);edge(a,c);edge(b,a);edge(b,c);edge(c,a);edge(c,b);}
  for(const r of rows){const d=r.a*r.c-r.b*r.b;for(const [s,t] of r.r){let x=0,y=0;if(d>1e-8){x=(r.c*s-r.b*t)/d;y=(r.a*t-r.b*s)/d;}const cap=Math.min(1,25/Math.max(1e-8,Math.hypot(x,y)));x*=cap;y*=cap;r.g.push([x*r.tx+y*r.ux,x*r.ty+y*r.uy,x*r.tz+y*r.uz]);}}
  return rows;
}
export function createSecondary(THREE,mesh,fit){
  const geo=mesh.geometry,pAttr=geo.attributes.position,nAttr=geo.attributes.normal,base=new Float32Array(pAttr.array),normal=new Float32Array(nAttr.array),regions=fit.secondaryRegions;
  if(base.length/3!==fit.fit.vertices)throw Error('Secondary fit vertex count mismatch');
  const {masks}=buildMasks(base,geo.attributes.skinIndex.array,geo.attributes.skinWeight.array,fit),rows=makeRows(base,normal,geo.index.array,masks);
  pAttr.setUsage(THREE.DynamicDrawUsage);nAttr.setUsage(THREE.DynamicDrawUsage);
  const states=regions.map(r=>({x:[0,0,0],v:[0,0,0],acc:[0,0,0],previous:null,velocity:new THREE.Vector3(),center:new THREE.Vector3(...r.center).sub(new THREE.Vector3(...fit.rest[fit.shapes[r.owner].root]))}));
  const q=new THREE.Quaternion(),aq=new THREE.Quaternion(),scale=new THREE.Vector3(),point=new THREE.Vector3(),velocity=new THREE.Vector3(),acceleration=new THREE.Vector3();let dirty=false;const touchHistory=new Map();
  const previousOffsets=new Float64Array(states.length*3);
  function write(force=false){
    let delta=0;for(let r=0;r<states.length;r++)for(let j=0;j<3;j++){const k=r*3+j,d=states[r].x[j];delta=Math.max(delta,Math.abs(previousOffsets[k]-d));}
    if(!force&&delta<.000025)return;
    for(let r=0;r<states.length;r++)previousOffsets.set(states[r].x,r*3);
    for(const row of rows){const k=row.k;let x=0,y=0,z=0,nx=normal[k],ny=normal[k+1],nz=normal[k+2];
      for(let r=0;r<states.length;r++){const w=row.m[r],d=states[r].x,g=row.g[r];if(w){x+=w*d[0];y+=w*d[1];z+=w*d[2];}const dot=d[0]*normal[k]+d[1]*normal[k+1]+d[2]*normal[k+2];nx-=g[0]*dot;ny-=g[1]*dot;nz-=g[2]*dot;}
      pAttr.array[k]=base[k]+x;pAttr.array[k+1]=base[k+1]+y;pAttr.array[k+2]=base[k+2]+z;const l=Math.hypot(nx,ny,nz)||1;nAttr.array[k]=nx/l;nAttr.array[k+1]=ny/l;nAttr.array[k+2]=nz/l;
    }
    // A single upload per attribute is cheaper than hundreds of sparse GPU
    // commands. Only affected vertices were calculated; native skinning stays.
    pAttr.needsUpdate=true;nAttr.needsUpdate=true;dirty=true;
  }
  function reset(){touchHistory.clear();for(const s of states){s.x.fill(0);s.v.fill(0);s.acc.fill(0);s.previous=null;s.velocity.set(0,0,0);}if(dirty)write(true);}
  function update(model,anchor,dt,settings,gravityOn=true,controllers=[]){
    if(!(dt>0))return;if(dt>.12){reset();return;}
    anchor.updateWorldMatrix(true,false);anchor.getWorldQuaternion(aq);anchor.getWorldScale(scale);const unit=Math.max(.1,scale.x);
    for(let i=0;i<states.length;i++){
      const r=regions[i],s=states[i],rotation=model.rotations[r.owner];point.copy(s.center).applyQuaternion(rotation).add(model.positions[r.owner]);anchor.localToWorld(point);
      if(!s.previous){s.previous=point.clone();s.velocity.set(0,0,0);}
      velocity.copy(point).sub(s.previous).divideScalar(dt);s.previous.copy(point);
      // Reject discontinuous reset/teleport poses; ordinary controller motion,
      // joystick translation and turns remain acceleration inputs.
      if(velocity.length()>14*unit){s.velocity.copy(velocity.clampLength(0,14*unit));s.acc.fill(0);continue;}
      acceleration.copy(velocity).sub(s.velocity).divideScalar(dt);s.velocity.copy(velocity);
      q.copy(aq).multiply(rotation).invert();acceleration.applyQuaternion(q).divideScalar(unit).clampLength(0,45);
      const alpha=1-Math.exp(-dt/.035);for(let k=0;k<3;k++)s.acc[k]+=(acceleration.getComponent(k)-s.acc[k])*alpha;
      const g=new THREE.Vector3(0,gravityOn?-9.81:0,0).applyQuaternion(q).divideScalar(unit).toArray(),force=[0,0,0];
      const side=r.owner===1?1:-1,shape=fit.shapes[r.owner],rest=fit.rest[shape.root];
      for(const controller of controllers){
        // Grip point transformed to the segment's rest-frame coordinates.
        const local=anchor.worldToLocal(controller.point.clone()).sub(model.positions[r.owner]).applyQuaternion(rotation.clone().invert());
        const k=controller.key+':'+i;let history=touchHistory.get(k);
        if(!history){history={previous:local.toArray(),active:false,cool:0,lastTangent:0};touchHistory.set(k,history);continue;}
        const prev=history.previous,cur=local.toArray();history.previous=cur;
        const dx=(cur[0]+rest[0]-r.center[0])/r.radius[0],dy=(cur[1]+rest[1]-r.center[1])/r.radius[1];
        if(dx*dx+dy*dy>1.12||Math.hypot(...cur.map((x,j)=>x-prev[j]))>10*dt/unit){history.active=false;history.cool=0;continue;}
        let surface=side>0?Infinity:-Infinity;
        for(const [a,b,c,d] of shape.planes)if(c*side>1e-6){const z=-(a*cur[0]+b*cur[1]+d)/c;surface=side>0?Math.min(surface,z):Math.max(surface,z);}
        // Use the authored region surface instead of treating the expanded
        // collision envelope as the visible skin. Limit to the actual hull.
        const authored=r.center[2]-rest[2]+side*.018+s.x[2];
        surface=side>0?Math.min(surface,authored):Math.max(surface,authored);
        const response=contactDrive(prev,cur,surface,side,dt,.045/unit,settings.contact,history);
        const falloff=Math.max(0,1-(dx*dx+dy*dy)*.65);
        for(let j=0;j<3;j++){force[j]+=response.force[j]*falloff;s.v[j]=clamp(s.v[j]+response.impulse[j]*falloff,-1.8,1.8);}
      }
      springStep(s,s.acc,dt,r,settings,g,force);
    }const active=new Set(controllers.map(c=>c.key));for(const key of touchHistory.keys())if(!active.has(key.split(':')[0]))touchHistory.delete(key);write();
  }
  return {update,reset,rows:rows.length,states};
}
