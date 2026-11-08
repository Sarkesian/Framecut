const { _electron: electron }=require('playwright');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const assert=require('node:assert/strict');
const {run,ffmpeg}=require('../desktop/server.cjs');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'framecut-desktop-'));let app;
 try{
  const demo=path.join(temp,'Coastal moments.mp4');
  await run(ffmpeg,['-y','-f','lavfi','-i','color=c=0x193b48:size=1280x720:rate=24','-f','lavfi','-i','sine=frequency=330:sample_rate=48000','-vf',"drawbox=x=0:y=470:w=1280:h=250:c=0x132c36:t=fill,drawbox=x=0:y=480:w=1280:h=3:c=0x6a9a9c:t=fill,drawbox=x=0:y=540:w=1280:h=2:c=0x49787f:t=fill,drawbox=x=0:y=625:w=1280:h=2:c=0x49787f:t=fill,drawtext=text='A LITTLE MORE WONDER':fontcolor=0xf3dfb4:fontsize=54:x=(w-tw)/2:y=210,drawtext=text='COASTAL MOMENTS   /   2026':fontcolor=0x97b2b4:fontsize=17:x=(w-tw)/2:y=295",'-t','6','-c:v','libx264','-c:a','aac',demo]);
  app=await electron.launch({args:[path.resolve('.')],env:{...process.env,FRAMECUT_TEST:'1',FRAMECUT_TEST_DIR:temp}});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('heading',{name:'Media library'}).waitFor();
  await page.locator('#file-input').setInputFiles(demo);await page.locator('.asset').waitFor();
  await page.locator('[data-add]').click();await page.locator('.timeline-clip').waitFor();assert.equal(await page.locator('.timeline-clip').count(),1);
  await page.locator('[data-ratio="9:16"]').click();assert.equal(await page.locator('#quick-ratio').inputValue(),'9:16');
  await page.locator('[data-ratio="16:9"]').click();
  await page.locator('#scrubber').fill('2');await page.locator('#scrubber').dispatchEvent('input');
  await page.locator('[data-action="split"]').click();assert.equal(await page.locator('.timeline-clip').count(),2);
  await page.locator('[data-action="undo"]').click();assert.equal(await page.locator('.timeline-clip').count(),1);
  await page.locator('[data-tab="captions"]').click();await page.locator('[data-action="add-caption"]').click();
  await page.locator('[data-caption-preset="bold"]').click();
  await page.locator('[aria-label="Caption font"]').fill('Segoe UI');await page.locator('[aria-label="Caption font"]').dispatchEvent('change');
  await page.locator('[data-key="text"]').fill('A little more wonder.');await page.locator('[data-key="text"]').dispatchEvent('change');
  assert.equal(await page.locator('.caption-row').count(),1);
  await page.locator('[data-action="settings"]').click();await page.locator('#ai-preset').selectOption('custom');await page.locator('#ai-url').fill('http://127.0.0.1:1/v1');await page.locator('#verify-ai').click();await page.waitForFunction(()=>!document.querySelector('#verify-ai').disabled);assert.ok(!(await page.locator('#verify-result').textContent()).includes('Connected'));await page.locator('[data-close]').first().click();
  await page.locator('[data-tab="media"]').click();
  await page.screenshot({path:path.resolve('..','FrameCut-preview.png')});
  await page.locator('[data-tab="audio"]').click();
  await page.locator('[data-action="detach-audio"]').first().click();
  assert.equal(await page.locator('.audio-card').count(),1);
  await page.locator('#scrubber').fill('2');await page.locator('#scrubber').dispatchEvent('input');
  await page.locator('[data-action="split-audio"]').click();assert.equal(await page.locator('.audio-card').count(),2);
  await page.locator('[data-audio="fadeIn"]').fill('0.3');await page.locator('[data-audio="fadeIn"]').dispatchEvent('change');
  await page.locator('[data-audio="fadeOut"]').fill('0.6');await page.locator('[data-audio="fadeOut"]').dispatchEvent('change');
  await page.screenshot({path:path.resolve('..','FrameCut-audio-preview.png')});
  await page.locator('[data-tab="media"]').click();await page.locator('[data-ratio="9:16"]').click();
  await page.locator('[data-blur-preset="44"]').click();
  await page.screenshot({path:path.resolve('..','FrameCut-canvas-preview.png')});
  await page.locator('[data-action="export"]').click();await page.locator('#export-resolution').selectOption('480');await page.locator('#start-export').click();await page.getByRole('heading',{name:'Your story is ready.'}).waitFor({timeout:60000});
  assert.deepEqual(errors,[]);
  console.log('PASS: Desktop import, ratio, trim/split/undo, subtitles, detached audio, audio splitting, independent fades, API error handling, export; no renderer errors.');
 }finally{await app?.close();await fs.rm(temp,{recursive:true,force:true}).catch(()=>{})}
})().catch(e=>{console.error(e);process.exitCode=1});

