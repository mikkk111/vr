/* Human Soft Body V1.0 — model-specific tetrahedral XPBD prototype. CPU solver; sampled surface contacts, not full OGC. */
export function createTissue(a,restSkin){
  const rest=a.points, n=rest.length/3, p=new Float64Array(rest), old=new Float64Array(rest), vel=new Float64Array(rest.length), target=new Float64Array(rest), t=a.tetrahedra, h=.008333333333333333;
  const edges=[], el=[], seen=new Set(), dets=[], volLambda=new Float64Array(t.length/4), tetherLambda=new Float64Array(rest.length);
  for(let k=0;k<t.length;k+=4){
    const A=t[k]*3,B=t[k+1]*3,C=t[k+2]*3,D=t[k+3]*3;
    const ux=rest[B]-rest[A],uy=rest[B+1]-rest[A+1],uz=rest[B+2]-rest[A+2],vx=rest[C]-rest[A],vy=rest[C+1]-rest[A+1],vz=rest[C+2]-rest[A+2],wx=rest[D]-rest[A],wy=rest[D+1]-rest[A+1],wz=rest[D+2]-rest[A+2];
    const det=ux*(vy*wz-vz*wy)+uy*(vz*wx-vx*wz)+uz*(vx*wy-vy*wx);
    if(!(det>1e-12))throw Error("Degenerate or inverted rest tetrahedron "+k/4);
    dets.push(det);
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){let x=Math.min(t[k+i],t[k+j]),y=Math.max(t[k+i],t[k+j]),key=x*n+y;if(seen.has(key))continue;seen.add(key);edges.push(x*3,y*3);el.push(Math.hypot(rest[x*3]-rest[y*3],rest[x*3+1]-rest[y*3+1],rest[x*3+2]-rest[y*3+2]));}
  }
  const edgeLambda=new Float64Array(el.length), samples=a.samples, s=new Float64Array(samples.length*3), restS=new Float64Array(samples.length*3), correction=new Float64Array(p.length), hits=new Uint16Array(n);
  for(let i=0;i<samples.length;i++)restS.set(restSkin.subarray(samples[i]*3,samples[i]*3+3),i*3);
  const previousS=new Float64Array(samples.length*3), denom=new Float64Array(samples.length);
  for(let i=0;i<samples.length;i++){let v=samples[i]*8;for(let j=0;j<8;j++)denom[i]+=a.blend[v+j]**2;}
  const stats={nodes:n,tets:dets.length,edges:el.length,samples:samples.length,contacts:0,penetration:0,volumeRatio:1,inverted:0};
  const key=(x,y,z)=>((x+2048)*4096+(y+2048))*4096+(z+2048);
  function embed(out,indices=null){
    const count=indices?indices.length:restSkin.length/3;
    for(let i=0;i<count;i++){const v=(indices?indices[i]:i)*8;let x=0,y=0,z=0;for(let j=0;j<8;j++){let k=a.cellCorners[v+j]*3,w=a.blend[v+j];x+=p[k]*w;y+=p[k+1]*w;z+=p[k+2]*w;}out[i*3]=x;out[i*3+1]=y;out[i*3+2]=z;}
    return out;
  }
  function accumulate(i,x,y,z){
    const v=samples[i]*8,inv=1/Math.max(.125,denom[i]);
    for(let j=0;j<8;j++){const k=a.cellCorners[v+j],w=a.blend[v+j]*inv; if(Math.abs(w)<1e-8)continue;correction[k*3]+=x*w;correction[k*3+1]+=y*w;correction[k*3+2]+=z*w;hits[k]++;}
  }
  function contact(floor,presses,react){
    embed(s,samples);correction.fill(0);hits.fill(0);
    const cell=.034,margin=.029,map=new Map();let pairs=0,deep=0;
    for(let i=0;i<samples.length;i++){let k=i*3,x=s[k],y=s[k+1],z=s[k+2],ix=Math.floor(x/cell),iy=Math.floor(y/cell),iz=Math.floor(z/cell);
      for(let u=-1;u<=1;u++)for(let v=-1;v<=1;v++)for(let w=-1;w<=1;w++){const bucket=map.get(key(ix+u,iy+v,iz+w));if(!bucket)continue;
        for(const j of bucket){const q=j*3;let rx=restS[k]-restS[q],ry=restS[k+1]-restS[q+1],rz=restS[k+2]-restS[q+2];const restDist=Math.hypot(rx,ry,rz);
          if(a.exclusionOffsets){let lo=a.exclusionOffsets[i],hi=a.exclusionOffsets[i+1]-1,skip=false;while(lo<=hi){let mid=(lo+hi)>>>1,k=a.exclusionIndices[mid];if(k===j){skip=true;break;}if(k<j)lo=mid+1;else hi=mid-1;}if(skip)continue;}else if(restDist<.075)continue;
          const separation=Math.min(margin,restDist*.85);if(separation<1e-5)continue;
          let dx=x-s[q],dy=y-s[q+1],dz=z-s[q+2],d=Math.hypot(dx,dy,dz);if(d>=separation)continue;
          if(d<1e-7){d=Math.hypot(rx,ry,rz);dx=rx/d;dy=ry/d;dz=rz/d;d=0;}else{dx/=d;dy/=d;dz/=d;}
          const dep=separation-d,step=Math.min(.012,dep*.47);
          let tx=(x-previousS[k])-(s[q]-previousS[q]),ty=(y-previousS[k+1])-(s[q+1]-previousS[q+1]),tz=(z-previousS[k+2])-(s[q+2]-previousS[q+2]),dot=tx*dx+ty*dy+tz*dz;
          tx-=dot*dx;ty-=dot*dy;tz-=dot*dz;let fr=Math.min(.5,step*.65/Math.max(1e-8,Math.hypot(tx,ty,tz)));
          const cx=dx*step-tx*fr,cy=dy*step-ty*fr,cz=dz*step-tz*fr;
          accumulate(i,cx,cy,cz);accumulate(j,-cx,-cy,-cz);
          if(react){react(samples[i],x,y,z,cx,cy,cz);react(samples[j],s[q],s[q+1],s[q+2],-cx,-cy,-cz);}
          pairs++;deep=Math.max(deep,dep);
        }
      }
      const cellKey=key(ix,iy,iz);let bucket=map.get(cellKey);if(!bucket)map.set(cellKey,bucket=[]);bucket.push(i);
      if(floor){const d=x*floor.x+y*floor.y+z*floor.z+floor.c;if(d<.004){let dep=Math.min(.025,.004-d);let tx=x-previousS[k],ty=y-previousS[k+1],tz=z-previousS[k+2],dot=tx*floor.x+ty*floor.y+tz*floor.z;tx-=dot*floor.x;ty-=dot*floor.y;tz-=dot*floor.z;let fr=Math.min(.8,dep*.8/Math.max(1e-8,Math.hypot(tx,ty,tz)));accumulate(i,floor.x*dep-tx*fr,floor.y*dep-ty*fr,floor.z*dep-tz*fr);deep=Math.max(deep,.004-d);if(react)react(samples[i],x,y,z,floor.x*dep,floor.y*dep,floor.z*dep);}}
      for(const hand of presses){let dx=x-hand.x,dy=y-hand.y,dz=z-hand.z,d=Math.hypot(dx,dy,dz);if(d<hand.r&&d>1e-7){const dep=Math.min(.022,hand.r-d),m=dep/d;accumulate(i,dx*m,dy*m,dz*m);if(react)react(samples[i],x,y,z,dx*m,dy*m,dz*m);}}
    }
    for(let i=0;i<n;i++)if(hits[i]){let k=i*3,f=1/Math.max(1,hits[i]*.45),dx=correction[k]*f,dy=correction[k+1]*f,dz=correction[k+2]*f,m=Math.min(1,.025/Math.max(1e-9,Math.hypot(dx,dy,dz)));p[k]+=dx*m;p[k+1]+=dy*m;p[k+2]+=dz*m;}
    stats.contacts=pairs;stats.penetration=deep;
  }
  function solveVolume(k,measure=false){
    const a0=t[k*4]*3,b=t[k*4+1]*3,c=t[k*4+2]*3,d=t[k*4+3]*3;
    const ux=p[b]-p[a0],uy=p[b+1]-p[a0+1],uz=p[b+2]-p[a0+2],vx=p[c]-p[a0],vy=p[c+1]-p[a0+1],vz=p[c+2]-p[a0+2],wx=p[d]-p[a0],wy=p[d+1]-p[a0+1],wz=p[d+2]-p[a0+2],r=dets[k];
    const bx=(vy*wz-vz*wy)/r,by=(vz*wx-vx*wz)/r,bz=(vx*wy-vy*wx)/r,cx=(wy*uz-wz*uy)/r,cy=(wz*ux-wx*uz)/r,cz=(wx*uy-wy*ux)/r,dx=(uy*vz-uz*vy)/r,dy=(uz*vx-ux*vz)/r,dz=(ux*vy-uy*vx)/r,ax=-bx-cx-dx,ay=-by-cy-dy,az=-bz-cz-dz;
    const ratio=ux*bx+uy*by+uz*bz;if(measure)return ratio;
    const alpha=.00012/(h*h),den=ax*ax+ay*ay+az*az+bx*bx+by*by+bz*bz+cx*cx+cy*cy+cz*cz+dx*dx+dy*dy+dz*dz+alpha;
    let dl=(-(ratio-1)-alpha*volLambda[k])/Math.max(1e-9,den);const gmax=Math.max(Math.hypot(ax,ay,az),Math.hypot(bx,by,bz),Math.hypot(cx,cy,cz),Math.hypot(dx,dy,dz));dl=Math.sign(dl)*Math.min(Math.abs(dl),.011/Math.max(1e-9,gmax));volLambda[k]+=dl;
    p[a0]+=dl*ax;p[a0+1]+=dl*ay;p[a0+2]+=dl*az;p[b]+=dl*bx;p[b+1]+=dl*by;p[b+2]+=dl*bz;p[c]+=dl*cx;p[c+1]+=dl*cy;p[c+2]+=dl*cz;p[d]+=dl*dx;p[d+1]+=dl*dy;p[d+2]+=dl*dz;
  }
  function step(gravity,floor,presses=[],react=null){
    old.set(p);embed(previousS,samples);edgeLambda.fill(0);volLambda.fill(0);tetherLambda.fill(0);
    for(let i=0;i<n;i++){let k=i*3;for(let q=0;q<3;q++){let j=k+q;vel[j]=vel[j]*.965+gravity[q]*h;p[j]+=vel[j]*h;}}
    for(let iter=0;iter<3;iter++){
      for(let i=0;i<n;i++){let k=i*3,alpha=a.compliance[i]/(h*h);for(let j=k;j<k+3;j++){let dl=(-(p[j]-target[j])-alpha*tetherLambda[j])/(1+alpha);dl=Math.max(-.028,Math.min(.028,dl));p[j]+=dl;tetherLambda[j]+=dl;}}
      for(let e=0;e<el.length;e++){let i=edges[e*2],j=edges[e*2+1],x=p[j]-p[i],y=p[j+1]-p[i+1],z=p[j+2]-p[i+2],l=Math.hypot(x,y,z);if(l<1e-8)continue;let alpha=.000055/(h*h),dl=(-(l-el[e])-alpha*edgeLambda[e])/(2+alpha);dl=Math.max(-.012,Math.min(.012,dl));edgeLambda[e]+=dl;let f=dl/l;p[i]-=x*f;p[i+1]-=y*f;p[i+2]-=z*f;p[j]+=x*f;p[j+1]+=y*f;p[j+2]+=z*f;}
      for(let k=0;k<dets.length;k++)solveVolume(k);
      if(iter===1||iter===2)contact(floor,presses,iter===2?react:null);
    }
    for(let i=0;i<n;i++){let k=i*3;let x=(p[k]-old[k])/h,y=(p[k+1]-old[k+1])/h,z=(p[k+2]-old[k+2])/h,m=Math.min(1,5/Math.max(1e-9,Math.hypot(x,y,z)));if(!Number.isFinite(x+y+z)){p[k]=target[k];p[k+1]=target[k+1];p[k+2]=target[k+2];x=y=z=0;}vel[k]=x*m;vel[k+1]=y*m;vel[k+2]=z*m;}
  }
  function measure(){let sum=0,tot=0,inv=0;for(let k=0;k<dets.length;k++){let r=solveVolume(k,true);sum+=r*dets[k];tot+=dets[k];if(r<=0)inv++;}stats.volumeRatio=sum/tot;stats.inverted=inv;return stats;}
  function reset(){p.set(target);old.set(target);vel.fill(0);}
  return {p,target,stats,h,step,measure,reset,embed,samplePositions:()=>embed(s,samples)};
}
