const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {timelinePreviewClip,filmstripTiles,sliceGainKeys}=require('../shared/timeline-preview.mjs');
const {keyGain}=require('../shared/audio.mjs');
const {Library}=require('../desktop/library.cjs'),{JobQueue}=require('../desktop/jobs.cjs');
const {run,ffmpeg}=require('../desktop/tools.cjs');
const strip={count:80,w:160,h:90,interval:.5,version:2,sampleStart:0};
test('Live trims use the new source in-point; interior thumbnails remain source anchored at every speed and zoom',()=>{
 for(const speed of [.5,1,2])for(const zoom of [25,80,240]){
  const c={id:'c',mediaId:'m',start:3,in:1.2,duration:10,speed};
  const before=filmstripTiles(c,strip,{zoom,height:43});
  const v=timelinePreviewClip(c,{mode:'trim',edge:'start',ids:['c'],dt:.7},false);
  assert.equal(v.in,c.in+.7*speed);assert.equal(v.start,3.7);assert.equal(v.duration,9.3);
  for(const tile of filmstripTiles(v,strip,{zoom,height:43})){
   const old=before.find(x=>x.id===tile.id);if(!old||tile.left<0||tile.left+tile.width>v.duration*zoom)continue;
   assert.ok(Math.abs((v.start*zoom+tile.left)-(c.start*zoom+old.left))<1e-7);
   assert.equal(tile.index,old.index);assert.ok(Math.abs(tile.width/43-160/90)<1e-8);
  }
  const end=timelinePreviewClip(c,{mode:'trim',edge:'end',ids:['c'],dt:-1},false);assert.equal(end.in,c.in);
  const ripple=timelinePreviewClip(c,{mode:'trim',edge:'start',ids:['c'],dt:.7,ripple:true},false);assert.equal(ripple.start,c.start);assert.equal(ripple.in,v.in);
  const move=timelinePreviewClip(v,{mode:'move',ids:['c'],dt:2},false);assert.deepEqual(filmstripTiles(move,strip,{zoom,height:43}),filmstripTiles(v,strip,{zoom,height:43}));
 }
});
test('Repeated trims preserve volume and duck automation at the cut boundary',()=>{
 const keys=[{t:0,v:1},{t:3,v:.2},{t:8,v:.9}];const once=sliceGainKeys(keys,1.5,5),twice=sliceGainKeys(once,1,3);
 for(let t=0;t<=3;t+=.1)assert.ok(Math.abs(keyGain(twice,t)-keyGain(keys,t+2.5))<1e-8);
});
test('Filmstrip cache samples real source frames, preserves aspect ratio and coalesces repeated requests',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fc-strip-')),jobs=new JobQueue({lanes:{light:2,heavy:1,export:1}});let lib;
 try{
  const video=path.join(dir,'Frames.mp4');await run(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=10:d=8','-c:v','libx264','-g','80','-pix_fmt','yuv420p',video]);
  lib=new Library({dataDir:dir,cacheDir:path.join(dir,'cache'),jobs,prefs:()=>({proxies:'off'})});await lib.init();const a=await lib.importPath(video);
  const j=lib.ensureFilmstrip(a);assert.equal(j,lib.ensureFilmstrip(a));await j.promise;
  assert.equal(a.strip.version,2);assert.equal(a.strip.sampleStart,0);assert.equal(a.strip.count,16);assert.equal(lib.ensureFilmstrip(a),null);
  for(const i of [0,1,7,15]){
   const [actual,expected]=await Promise.all([
    run(ffmpeg,['-v','error','-i',a.strip.file,'-vf',`crop=160:90:${i*160}:0,format=rgb24`,'-frames:v','1','-f','rawvideo','-'],{encoding:'buffer'}),
    run(ffmpeg,['-v','error','-ss',String(i*.5),'-i',video,'-vf','scale=160:90,format=rgb24','-frames:v','1','-f','rawvideo','-'],{encoding:'buffer'})]);
   let sum=0;for(let k=0;k<actual.out.length;k++)sum+=Math.abs(actual.out[k]-expected.out[k]);assert.ok(sum/actual.out.length<10,'frame '+i+' error '+sum/actual.out.length);
  }
  assert.ok(!(await fs.readdir(lib.dirs.strips)).some(n=>n.startsWith('.frames-')));
 }finally{await lib?.flush();await fs.rm(dir,{recursive:true,force:true});}
});
