const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {run,ffmpeg,ffprobe,startServer}=require('../desktop/server.cjs');
const {renderArgs,dimensions,ass}=require('../desktop/render.cjs');
test('Ratios produce even dimensions and portrait orientation',()=>{assert.deepEqual(dimensions('9:16',720),[720,1280]);assert.deepEqual(dimensions('1:1',1080),[1080,1080]);assert.deepEqual(dimensions('16:9',1080),[1920,1080])});
test('Caption payload cannot inject ASS drawing commands',()=>{const text=ass({burnCaptions:true,captions:[{start:0,end:1,text:'{\\p1}attack\nsecond'}]},640,360);assert.ok(!text.includes('{\\p1}'));assert.ok(text.includes('second'))});
test('Real export: mixed sizes, missing audio, speed, captions, title and music',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'framecut-test-'));
  try {
    const one=path.join(dir,'one.mp4'),two=path.join(dir,'two.mp4'),music=path.join(dir,'music.wav');
    await run(ffmpeg,['-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-c:a','aac',one]);
    await run(ffmpeg,['-y','-f','lavfi','-i','color=c=blue:size=180x320:rate=30','-t','2','-c:v','libx264',two]);
    await run(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','1',music]);
    const assets=new Map([['one',{path:one,video:true,audio:true,duration:2}],['two',{path:two,video:true,audio:false,duration:2}],['music',{path:music,audio:true}]]);
    const project={ratio:'9:16',resolution:480,fps:30,fit:'crop',clips:[{mediaId:'one',start:.25,end:1.75,speed:1.5,volume:.5,fade:.2},{mediaId:'two',start:0,end:1,speed:1,volume:0}],audioClips:[{mediaId:'one',start:.2,end:1.8,speed:1.2,position:.3,volume:.2,fade:.2}],musicId:'music',musicVolume:.1,burnCaptions:true,captions:[{start:0,end:1,text:'Caption export works'}],titles:[{start:0,end:.5,text:'FRAMECUT'}]};
    project.canvasBackground='blur';project.canvasBlur=44;project.captionFont='Impact';project.captionPreset='highlight';project.captionColor='#b9f675';project.captionPosition='middle';project.captions[0].words=[{start:0,end:.4,text:'Caption'},{start:.4,end:.7,text:'export'},{start:.7,end:1,text:'works'}];
    for(const format of ['mp4','webm','mp3','wav']){
      const output=path.join(dir,'test.'+format),plan=renderArgs({...project,format},assets,output);
      await fs.writeFile(path.join(dir,'captions.ass'),plan.subtitles);for(const file of plan.files||[])await fs.writeFile(path.join(dir,file.name),file.content);await run(ffmpeg,plan.args,{cwd:dir});
      const probe=JSON.parse((await run(ffprobe,['-v','quiet','-show_format','-show_streams','-of','json',output])).out);
      const video=probe.streams.find(s=>s.codec_type==='video');if(['mp4','webm'].includes(format)){assert.equal(video.width,480);assert.equal(video.height,854)}else assert.equal(video,undefined);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(+probe.format.duration-2)<.2);
    }
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('HTTP pipeline imports, saves, exports, and rejects foreign origins',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'framecut-http-'));let service;
  try{
    service=await startServer({dataDir:dir});const source=path.join(dir,'test.mp4');
    await run(ffmpeg,['-y','-f','lavfi','-i','color=c=green:size=160x90:rate=24','-t','1','-c:v','libx264',source]);
    const form=new FormData();form.append('files',new Blob([await fs.readFile(source)],{type:'video/mp4'}),'sample.mp4');
    const imported=await(await fetch(service.url+'/api/import',{method:'POST',body:form})).json();assert.equal(imported.assets.length,1);const media=imported.assets[0];assert.equal(media.path,undefined);
    const denied=await fetch(service.url+'/api/project',{method:'PUT',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
    const project={ratio:'1:1',resolution:480,format:'mp4',clips:[{mediaId:media.id,start:0,end:.5,speed:1}]};
    const exported=await(await fetch(service.url+'/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(project)})).json();assert.ok(exported.id);
    let job;for(let i=0;i<100;i++){job=await(await fetch(service.url+'/api/jobs/'+exported.id)).json();if(job.status!=='rendering')break;await new Promise(r=>setTimeout(r,100))}assert.equal(job.status,'done',job.error);
    const video=await fetch(service.url+'/api/jobs/'+exported.id+'/download');assert.equal(video.status,200);assert.ok((await video.arrayBuffer()).byteLength>1000);
  }finally{service?.close();await fs.rm(dir,{recursive:true,force:true})}
});
