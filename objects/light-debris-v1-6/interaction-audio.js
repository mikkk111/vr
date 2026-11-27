// Original procedural rainfall. No recordings, external assets or musical tones.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function defaultRegions(){
  return Array.from({length:8},(_,i)=>({x:(i&1?1:-1)*.72,y:(i&2?1:-1)*.38,z:(i&4?1:-1)*.38,density:1,motion:0}));
}
// Eight local-space regional centroids, measured from a small GPU sample.
// Signed octants keep the emitting volume spread around a listener inside it.
export function rainRegions(data){
  if(data.length%4!==0)throw Error('Invalid rain sample');
  const regions=defaultRegions(),sum=Array.from({length:8},()=>[0,0,0,0,0]);
  let total=0;
  for(let i=0;i<data.length;i+=4){
    const x=data[i],y=data[i+1],z=data[i+2],v=data[i+3];
    if(!Number.isFinite(x+y+z+v))continue;
    const j=(x>=0?1:0)|(y>=0?2:0)|(z>=0?4:0),s=sum[j];
    s[0]+=x;s[1]+=y;s[2]+=z;s[3]+=clamp(v,0,2.8);s[4]++;total++;
  }
  if(!total)return regions;
  for(let j=0;j<8;j++){
    const s=sum[j],r=regions[j],n=s[4];
    if(n){r.x=s[0]/n;r.y=s[1]/n;r.z=s[2]/n;r.motion=s[3]/n;}
    r.density=clamp(n*8/total,0,2.5);
  }
  return regions;
}
function rng(seed){let x=seed>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
// A circular rain texture: overlapping short, noisy droplet impacts with a
// soft broadband wash. No oscillator, bells, drone, melody or repeating beat.
export function makeRain(rate,seconds,seed){
  const n=Math.round(rate*seconds),out=new Float32Array(n),random=rng(seed);
  let low=0,slow=0;
  for(let i=0;i<n;i++){
    const white=random()*2-1;
    low+=.13*(white-low);slow+=.009*(white-slow);
    out[i]=(low-slow)*.22+(white-low)*.025;
  }
  const drops=Math.round(seconds*210);
  for(let k=0;k<drops;k++){
    const start=Math.floor(random()*n);
    const duration=.009+Math.pow(random(),1.5)*.035;
    const samples=Math.max(1,Math.floor(duration*rate));
    const decay=.0025+duration*.21,amp=.08+Math.pow(random(),2.5)*.48;
    const cutoff=700+random()*3600,alpha=1-Math.exp(-2*Math.PI*cutoff/rate);
    let lo=0,body=0;
    for(let j=0;j<samples;j++){
      const white=random()*2-1;lo+=alpha*(white-lo);body+=.045*(white-body);
      const t=j/rate,env=Math.min(1,t/.0007)*Math.exp(-t/decay);
      out[(start+j)%n]+=(lo-body)*env*amp;
    }
  }
  // Crossfade the seam without a silent hole; smooth amplitude normalisation.
  const fade=Math.floor(rate*.025);
  for(let i=0;i<fade;i++){
    const w=i/fade,mid=(out[i]+out[n-fade+i])*.5;
    out[i]=mid*(1-w)+out[i]*w;
    out[n-fade+i]=out[n-fade+i]*(1-w)+mid*w;
  }
  const seam=(out[0]+out[n-1])*.5;out[0]=seam;out[n-1]=seam;
  let energy=0,peak=0;for(const x of out){energy+=x*x;peak=Math.max(peak,Math.abs(x));}
  const gain=Math.min(.12/Math.max(1e-6,Math.sqrt(energy/n)),.86/Math.max(1e-6,peak));
  for(let i=0;i<n;i++)out[i]*=gain;
  return out;
}
export class RainAudio {
  constructor(onStatus=()=>{}){
    this.onStatus=onStatus;this.ctx=null;this.enabled=false;this.sessionAudible=true;
    this.volume=.48;this.ambient=0;this.effects=.70;this.generation=0;this.clouds=[];this.beams=[];
  }
  setParam(p,v,tau=.065){if(!p||!Number.isFinite(v))return;p.setTargetAtTime(v,this.ctx.currentTime,tau);}
  position(p,v){this.setParam(p.positionX,v.x,.04);this.setParam(p.positionY,v.y,.04);this.setParam(p.positionZ,v.z,.04);}
  panner(){const p=this.ctx.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=.65;p.maxDistance=60;p.rolloffFactor=1.05;return p;}
  voice(buffer,index,beam){
    const c=this.ctx,p=this.panner(),g=c.createGain(),hp=c.createBiquadFilter(),lp=c.createBiquadFilter();
    hp.type='highpass';hp.frequency.value=beam?1550:180;hp.Q.value=.45;
    lp.type='lowpass';lp.frequency.value=beam?8500:5100;lp.Q.value=.4;
    g.gain.value=0;
    const src=c.createBufferSource();src.buffer=buffer;src.loop=true;src.playbackRate.value=beam?1.65+index*.17:.88+index*.035;
    src.connect(hp);hp.connect(lp);lp.connect(g);g.connect(p);p.connect(beam?this.fxBus:this.rainBus);
    src.start(0,buffer.duration*((index*.381966+ (beam?.27:0))%1));
    return {p,g,hp,lp,src};
  }
  build(){
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)throw Error('Web Audio unavailable');
    const c=this.ctx=new Audio({latencyHint:'interactive'});
    this.master=c.createGain();this.master.gain.value=0;
    this.rainBus=c.createGain();this.rainBus.gain.value=this.ambient;
    this.fxBus=c.createGain();this.fxBus.gain.value=this.effects;
    const comp=c.createDynamicsCompressor();comp.threshold.value=-16;comp.knee.value=14;comp.ratio.value=6;comp.attack.value=.008;comp.release.value=.22;
    this.rainBus.connect(this.master);this.fxBus.connect(this.master);this.master.connect(comp);comp.connect(c.destination);
    // Four independent mono textures, different offsets and rates for each
    // emitter to avoid a phase-locked stereo image. Only two persistent interaction voices.
    const buffers=Array.from({length:4},(_,i)=>{
      const data=makeRain(c.sampleRate,4.5+i*.19,19071+i*7381);
      const b=c.createBuffer(1,data.length,c.sampleRate);b.copyToChannel(data,0);return b;
    });
    for(let i=0;i<2;i++)this.beams.push(this.voice(buffers[(i+2)%4],i,true));
  }
  async enable(){
    try{
      if(!this.ctx)this.build();
      const token=++this.generation;this.enabled=true;
      await this.ctx.resume();
      if(token!==this.generation||!this.enabled)return false;
      this.applyMaster();this.onStatus(this.ctx.state==='running'?'Interaction audio active — silent between triggers':'Audio suspended — tap Enable audio');return this.ctx.state==='running';
    }catch(e){this.enabled=false;this.applyMaster();this.onStatus('Audio unavailable: '+e.message);return false;}
  }
  applyMaster(){if(this.ctx&&this.master)this.setParam(this.master.gain,this.enabled&&this.sessionAudible?this.volume:0,.065);}
  setLevels(master,rain,beam){this.volume=clamp(master,0,1);this.ambient=0;this.effects=clamp(beam,0,1);if(this.ctx&&this.rainBus){this.setParam(this.rainBus.gain,this.ambient);this.setParam(this.fxBus.gain,this.effects);this.applyMaster();}}
  setAudible(v){this.sessionAudible=!!v;this.applyMaster();if(!v)this.silenceBeams();}
  disable(){this.generation++;this.enabled=false;this.applyMaster();this.silenceBeams();this.onStatus('Audio off');}
  get running(){return this.enabled&&this.sessionAudible&&this.ctx?.state==='running';}
  silenceBeams(){for(const b of this.beams)this.setParam(b.g.gain,0,.06);}
  listener(pos,forward,up){
    if(!this.running)return;const l=this.ctx.listener;this.position(l,pos);
    for(const [key,val] of Object.entries({forwardX:forward.x,forwardY:forward.y,forwardZ:forward.z,upX:up.x,upY:up.y,upZ:up.z}))this.setParam(l[key],val,.025);
  }
  beam(i,active,pos,hit,motion){
    if(!this.running)return;const v=this.beams[i];this.position(v.p,pos);
    this.setParam(v.g.gain,active?(hit?.52:.31):0,active?.055:.15);
    this.setParam(v.src.playbackRate,1.65+i*.17+clamp(motion,0,5)*.055,.12);
    this.setParam(v.hp.frequency,1550+clamp(motion,0,5)*110,.12);
  }
}
