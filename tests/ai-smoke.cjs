const { _electron: electron }=require('playwright');
const path=require('node:path'), fs=require('node:fs/promises'), os=require('node:os');
const {execFileSync}=require('node:child_process');
const {run,ffmpeg}=require('../desktop/server.cjs');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'framecut-ai-'));let app;
 try{
  app=await electron.launch({args:[path.resolve('.')],env:{...process.env,FRAMECUT_TEST:'1',FRAMECUT_TEST_DIR:temp}});
  const page=await app.firstWindow();await page.getByRole('heading',{name:'Media library'}).waitFor();
  const speech=path.join(temp,'speech.wav'), raw=path.join(temp,'speech.f32');
  execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Speech; $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speaker.SetOutputToWaveFile('${speech.replace(/'/g,"''")}'); $speaker.Speak('Welcome to the video editor. This is a test of automatic subtitles.'); $speaker.Dispose()`],{windowsHide:true});
  await run(ffmpeg,['-y','-i',speech,'-ar','16000','-ac','1','-f','f32le',raw]);
  const samples=new Float32Array(new Uint8Array(await fs.readFile(raw)).buffer);
  const worker=(await fs.readdir('dist/assets')).find(n=>n.startsWith('transcribe.worker-'));
  await page.exposeFunction('aiProgress',s=>console.log('LOCAL_AI: '+s));
  const result=await page.evaluate(({worker,audio})=>new Promise((resolve,reject)=>{
    const w=new Worker('/assets/'+worker,{type:'module'}),timer=setTimeout(()=>{w.terminate();reject(Error('Local AI smoke test exceeded five minutes.'))},300000);
    w.onmessage=({data})=>{if(data.type==='progress')window.aiProgress(data.message);if(data.type==='error'){clearTimeout(timer);w.terminate();reject(Error(data.message))}if(data.type==='done'){clearTimeout(timer);w.terminate();resolve(data.result)}};
    w.onerror=e=>{clearTimeout(timer);reject(Error(e.message))};w.postMessage({audio:new Float32Array(audio)});
  }),{worker,audio:Array.from(samples)});
  if(!/video editor/i.test(result.text)||!/subtitles/i.test(result.text))throw Error('Speech model returned an unexpected transcript: '+result.text);
  console.log('PASS: Bundled browser Whisper model loaded and completed local inference. '+JSON.stringify(result));
 }finally{await app?.close();await fs.rm(temp,{recursive:true,force:true}).catch(()=>{})}
})().catch(e=>{console.error(e);process.exitCode=1});
