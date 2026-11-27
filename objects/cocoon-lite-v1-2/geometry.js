// Lightweight decoder for the pinned original cocoon fibre data.
// Only selected geometry is decoded; trained weights and AVIF are not loaded.
export const BUDGET={wound:[3200,3],fuzz:[3000,3],down:[6500,2],floss:[160,4]};
export function radial(shape,x,y,z){
 const w=(1+.05*x)*(1-.022*Math.exp(-Math.pow(x/.42,2)));
 return Math.pow(Math.pow(Math.abs(x)/shape.A,shape.p)+Math.pow(Math.hypot(y,z)/(shape.B*w),shape.p),-1/shape.p);
}
export function decodePath(bytes,kind,i,base,span){
 const P=kind.points,n=kind.n,m=n*P*3,out=new Float32Array(P*3);
 if(bytes.length!==m*2||i<0||i>=n)throw Error('Invalid fibre section');
 for(let c=0;c<3;c++){let q=0,step=0;for(let j=0;j<P;j++){
  const o=(c*P+j)*n+i,zig=bytes[o]|(bytes[m+o]<<8);
  if(j===0)q=zig;else{const d=zig&1?-(zig+1)/2:zig/2;step=j===1?d:step+d;q+=step;}
  out[j*3+c]=base[c]+q/65535*span;
 }}
 if(!out.every(Number.isFinite))throw Error('Non-finite fibre geometry');return out;
}
export function uv(x,y,z){const len=Math.hypot(x,y,z)||1;return [(Math.atan2(z,y)/Math.PI/2+1)%1,Math.acos(Math.max(-1,Math.min(1,x/len)))/Math.PI,len];}
export function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}}
export async function fetchGeometry(base,status){
 status('Loading original compressed silk geometry…');
 const [h,b]=await Promise.all([fetch(base+'cocoon.json'),fetch(base+'cocoon.bin')]);
 if(!h.ok||!b.ok)throw Error('Original geometry download failed: '+h.status+'/'+b.status);
 const head=await h.json();if(!b.body)throw Error('Missing binary response');
 const raw=await new Response(b.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const expected=Object.values(head.sections).reduce((n,[at,len])=>Math.max(n,at+len),0);
 if(raw.byteLength!==expected||head.cocoons.length!==1)throw Error('Unexpected original asset length');
 const {base:origin,span}=head.points,shape=head.cocoons[0];
 function path(k,i){const section=head.sections['points.'+k];return decodePath(new Uint8Array(raw,section[0],section[1]),head.kinds[k],i,origin,span)}
 return {head,shape,path};
}
