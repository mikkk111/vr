import * as THREE from 'three/webgpu';
import {wgslFn} from 'three/tsl';

// A compact analytical optical model. Geometry and ray intersections share
// exactly the same convex polyhedron; no per-object BVH or scene ray traversal.
export const OPTICS={fast:{label:'Surface glass',bounces:0,rgb:false},solid:{label:'Solid glass',bounces:2,rgb:false},prism:{label:'Prismatic glass',bounces:4,rgb:true}};

export function shapeGeometry(input,index){
  let g=input.index?input.toNonIndexed():input;
  if(g!==input)input.dispose();
  // Affine distortion keeps every piece solid/convex with perfectly matched
  // optical boundary planes. Different shape families have different shear.
  const s=[.08,-.12,.15,-.09][index],t=[-.07,.09,.04,.13][index];
  const a=g.getAttribute('position');
  for(let i=0;i<a.count;i++){
    const x=a.getX(i),y=a.getY(i),z=a.getZ(i);
    a.setXYZ(i,x+s*y+t*z,y+.09*z,z-.055*x);
  }
  a.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();
  const planes=[],v0=new THREE.Vector3(),v1=new THREE.Vector3(),v2=new THREE.Vector3(),n=new THREE.Vector3();
  for(let i=0;i<a.count;i+=3){
    v0.fromBufferAttribute(a,i);v1.fromBufferAttribute(a,i+1);v2.fromBufferAttribute(a,i+2);
    n.subVectors(v1,v0).cross(v2.sub(v0)).normalize();
    let d=n.dot(v0);if(d<0){n.negate();d=-d;}
    if(d<1e-5)throw Error('Degenerate optical plane');
    if(!planes.some(p=>p.n.dot(n)>.99999&&Math.abs(p.d-d)<.0001))planes.push({n:n.clone(),d});
  }
  if(planes.length!==[4,6,8,6][index])throw Error('Optical geometry plane count '+planes.length);
  for(let i=0;i<a.count;i++){
    v0.fromBufferAttribute(a,i);
    if(planes.some(p=>p.n.dot(v0)>p.d+.0001))throw Error('Non-convex optical shape');
  }
  return {geometry:g,planes};
}
const f=x=>Math.abs(x)<1e-8?'0.0':Number(x).toFixed(8);
const v=n=>'vec3f('+[n.x,n.y,n.z].map(f).join(',')+')';

// Procedural HDR-style studio reflections: large softboxes, narrow strip
// highlights and a low blue-grey fill. They are NOT passthrough camera pixels.
const environment=wgslFn(`fn debrisStudio(ray:vec3f) -> vec3f {
  let r=normalize(ray);
  let top=smoothstep(0.76,0.97,dot(r,normalize(vec3f(-0.32,0.86,0.4))));
  let strip=smoothstep(0.91,0.992, dot(r,normalize(vec3f(0.82,0.18,-0.54))));
  let rim=smoothstep(0.88,0.992, dot(r,normalize(vec3f(-0.84,-0.12,-0.5))));
  let broad=pow(max(0.0,dot(r,normalize(vec3f(0.12,0.35,0.93)))),8.0);
  let horizon=pow(max(0.0,1.0-abs(r.y)),13.0);
  return vec3f(0.020,0.029,0.045)+vec3f(0.13,0.18,0.24)*broad+
    vec3f(2.4,2.28,2.10)*top+vec3f(1.5,1.9,2.6)*strip+
    vec3f(1.9,1.12,0.68)*rim+vec3f(0.10,0.14,0.20)*horizon;
}`);
const safe=wgslFn(`fn debrisSafe(v:vec3f) -> vec3f {
 return v*inverseSqrt(max(dot(v,v),0.00000001));
}`);
const lampLight=wgslFn(`fn debrisLamp(ray:vec3f, lamp:vec4f, tint:vec3f) -> vec3f {
  let d2=max(dot(lamp.xyz,lamp.xyz),0.0004);
  let l=lamp.xyz*inverseSqrt(d2);
  let alignment=max(dot(ray,l),0.0);
  let spot=pow(alignment,42.0)*2.6+pow(alignment,7.0)*0.14;
  return tint*spot*lamp.w/(0.24+4.0*d2);
}`);
const envLit=wgslFn(`fn debrisEnv(ray:vec3f, la:vec4f, lb:vec4f, ca:vec3f, cb:vec3f) -> vec3f {
 return debrisStudio(ray)+debrisLamp(ray,la,ca)+debrisLamp(ray,lb,cb);
}`,[environment,lampLight]);

export function glassFunction(planes,index,mode){
  const opt=OPTICS[mode];
  // A nearest positive ray/plane intersection. The other interfaces are
  // tested too, rather than assuming a thin sheet or parallel back face.
  const tests=planes.map((p,i)=>`
    let pn${i}=${v(p.n)};
    let denom${i}=dot(rd,pn${i});
    if(denom${i}>0.00001){
      let t${i}=(${f(p.d)}-dot(ro,pn${i}))/denom${i};
      if(t${i}>0.00001 && t${i}<best){best=t${i};normal=pn${i};}
    }`).join('\n');
  const intersect=wgslFn(`fn debrisExit${index}(ro:vec3f,rd:vec3f) -> vec4f {
    var best=10000.0;var normal=vec3f(0.0,1.0,0.0);
    ${tests}
    return vec4f(normal,best);
  }`);
  const trace=wgslFn(`fn debrisTrace${index}(p:vec3f, incident:vec3f, surfaceN:vec3f, geometricN:vec3f, ior:f32,
      bx:vec3f,by:vec3f,bz:vec3f, size:f32, la:vec4f,lb:vec4f,ca:vec3f,cb:vec3f, seed:f32) -> vec3f {
    let reflected=reflect(incident,surfaceN);
    let worldR=debrisSafe(bx*reflected.x+by*reflected.y+bz*reflected.z);
    let r0=pow((ior-1.0)/(ior+1.0),2.0);
    let fresnel=r0+(1.0-r0)*pow(1.0-clamp(-dot(incident,surfaceN),0.0,1.0),5.0);
    var result=debrisEnv(worldR,la,lb,ca,cb)*fresnel;
    var weight=1.0-fresnel;
    var rd=refract(incident,surfaceN,1.0/ior);
    if(dot(rd,geometricN)>=-0.0001){rd=refract(incident,geometricN,1.0/ior);}
    rd=debrisSafe(rd);
    ${opt.bounces===0?`
    let rw=debrisSafe(bx*rd.x+by*rd.y+bz*rd.z);
    return result+debrisEnv(rw,la,lb,ca,cb)*weight*vec3f(0.91,0.97,0.99);
    `:`
    var ro=p-geometricN*0.0006;
    var tint=vec3f(1.0);
    let absorption=vec3f(1.5+seed*.65,0.34+seed*.3,0.22);
    for(var bounce=0;bounce<${opt.bounces};bounce=bounce+1){
      let hit=debrisExit${index}(ro,rd);
      if(hit.w>9999.0){break;}
      let hp=ro+rd*hit.w;
      let outward=hit.xyz;
      tint=tint*exp(-absorption*hit.w*size*8.0);
      let exiting=refract(rd,-outward,ior);
      if(dot(exiting,exiting)>0.00000001){
        let angle=clamp(dot(rd,outward),0.0,1.0);
        let internalF=r0+(1.0-r0)*pow(1.0-angle,5.0);
        let worldT=debrisSafe(bx*exiting.x+by*exiting.y+bz*exiting.z);
        result=result+debrisEnv(worldT,la,lb,ca,cb)*tint*weight*(1.0-internalF);
        weight=weight*internalF;
      }
      // When refraction returns zero, all remaining energy reflects internally.
      rd=debrisSafe(reflect(rd,-outward));
      ro=hp-outward*0.0006;
      if(weight<0.006){break;}
    }
    return result;
    `}
  }`,opt.bounces?[envLit,safe,intersect]:[envLit,safe]);
  return wgslFn(`fn debrisGlass${index}(p:vec3f,normal:vec3f,worldEye:vec3f,bx:vec3f,by:vec3f,bz:vec3f,seed:f32,size:f32,
      la:vec4f,lb:vec4f,ca:vec3f,cb:vec3f,ar:f32,flaws:f32) -> vec4f {
    let geometricN=debrisSafe(normal);
    let x=debrisSafe(bx);let y=debrisSafe(by);let z=debrisSafe(bz);
    let eye=debrisSafe(worldEye);
    let incident=-debrisSafe(vec3f(dot(eye,x),dot(eye,y),dot(eye,z)));
    // A low-amplitude irregular optical surface. Variation is tied to each
    // fragment's own coordinates and ID, not the screen or time.
    let phase=seed*29.0;
    let ripple=vec3f(sin(p.y*8.3+p.z*5.2+phase),sin(p.z*10.1+p.x*4.7-phase),sin(p.x*7.1+p.y*6.4+phase));
    let tangent=ripple-geometricN*dot(ripple,geometricN);
    var surfaceN=debrisSafe(geometricN+tangent*(0.025+seed*0.035)*flaws);
    if(dot(incident,surfaceN)>-0.002){surfaceN=geometricN;}
    let ior=1.50+seed*0.035;
    ${opt.rgb?`
    let red=debrisTrace${index}(p,incident,surfaceN,geometricN,ior-0.012,x,y,z,size,la,lb,ca,cb,seed);
    let green=debrisTrace${index}(p,incident,surfaceN,geometricN,ior,x,y,z,size,la,lb,ca,cb,seed);
    let blue=debrisTrace${index}(p,incident,surfaceN,geometricN,ior+0.018,x,y,z,size,la,lb,ca,cb,seed);
    var rgb=vec3f(red.r,green.g,blue.b);
    `:`
    var rgb=debrisTrace${index}(p,incident,surfaceN,geometricN,ior,x,y,z,size,la,lb,ca,cb,seed);
    `}
    // Fine glass flow lines and occasional internal-looking cloudy inclusions,
    // deliberately subtle, with no expensive random noise texture reads.
    let stria=pow(0.5+0.5*sin(p.x*25.0+p.y*8.0+sin(p.z*8.0+phase)*1.7+phase),19.0);
    let inclusion=pow(0.5+0.5*sin(p.x*13.0+phase)*sin(p.y*11.0-phase)*sin(p.z*17.0),16.0);
    rgb=rgb*(1.0-0.065*stria*flaws)+vec3f(0.012,0.017,0.021)*inclusion*flaws;
    let fres=0.04+0.96*pow(1.0-clamp(-dot(incident,surfaceN),0.0,1.0),5.0);
    let bright=max(rgb.r,max(rgb.g,rgb.b));
    let alpha=mix(1.0,clamp(0.11+fres*0.63+bright*0.36,0.12,0.94),ar);
    return vec4f(rgb+vec3f(0.007,0.01,0.016),alpha);
  }`,[trace,safe]);
}
