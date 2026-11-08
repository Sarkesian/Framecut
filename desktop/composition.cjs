const {dimensions,normalize,tempo,ass,num}=require('./render.cjs');
function renderArgs(project,assets,output){
  const clips=normalize(project,assets),[w,h]=dimensions(project.ratio,project.resolution),audioOnly=['mp3','wav'].includes(project.format),fps=[24,25,30,60].includes(+project.fps)?+project.fps:30;
  const tracks=project.tracks?.length?project.tracks:[{id:'captions-main',type:'captions'},{id:'video-main',type:'video'},{id:'audio-main',type:'audio'}];
  const trackFor=(c,type)=>tracks.find(t=>t.id===c.trackId&&t.type===type)||tracks.find(t=>t.type===type);
  const cursors=new Map();
  for(const c of clips){const t=trackFor(c,'video');c.trackId=t?.id;c.position=num(c.position,0,86400,cursors.get(c.trackId)||0);cursors.set(c.trackId,Math.max(cursors.get(c.trackId)||0,c.position+c.duration));c.track=t;c.scale=num(c.scale,.1,1,1);c.x=num(c.x,0,1,.5);c.y=num(c.y,0,1,.5)}
  const audioClips=(project.audioClips||[]).map(c=>{const media=assets.get(c.mediaId);if(!media?.audio)throw Error('An audio clip is missing its source.');const start=num(c.start,0,media.duration,0),end=num(c.end,0,media.duration,media.duration),speed=num(c.speed,.25,4,1);if(end-start<.05)throw Error('Audio clips must be at least 0.05 seconds long.');return {...c,media,start,end,speed,duration:(end-start)/speed,position:num(c.position,0,86400,0),volume:num(c.volume,0,2,1),fadeIn:num(c.fadeIn??c.fade,0,5,0),fadeOut:num(c.fadeOut??c.fade,0,5,0),track:trackFor(c,'audio')}});
  const total=Math.max(.05,...clips.map(c=>c.position+c.duration),...audioClips.map(c=>c.position+c.duration),...(project.captions||[]).map(c=>+c.end||0),...(project.titles||[]).map(c=>+c.end||0));
  const args=['-hide_banner','-y'];clips.forEach(c=>args.push('-i',c.media.path));
  const music=project.musicId&&assets.get(project.musicId);if(music)args.push('-stream_loop','-1','-i',music.path);audioClips.forEach(c=>args.push('-i',c.media.path));
  const filters=[],mix=['[silence]'],files=[];
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${total}[silence]`);
  if(!audioOnly)filters.push(`color=c=black:s=${w}x${h}:r=${fps}:d=${total},format=yuv420p[base0]`);
  clips.forEach((c,i)=>{
    if(!audioOnly&&!c.track?.hidden){
      const color=/^#[0-9a-f]{6}$/i.test(project.canvasColor||'')?'0x'+project.canvasColor.slice(1):'black';
      const fit=project.fit==='crop'?`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`:`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${project.canvasBackground==='color'?color:'black'}`;
      let v=`[${i}:v:0]trim=start=${c.start}:end=${c.end},setpts=(PTS-STARTPTS)/${c.speed},${fit}`;
      if(project.fit!=='crop'&&project.canvasBackground==='blur'){
        filters.push(`[${i}:v:0]trim=start=${c.start}:end=${c.end},setpts=(PTS-STARTPTS)/${c.speed},split=2[fgsrc${i}][bgsrc${i}]`);
        filters.push(`[bgsrc${i}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,gblur=sigma=${num(project.canvasBlur,3,60,24)*h/1080}[bg${i}]`);
        filters.push(`[fgsrc${i}]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fg${i}]`);
        v=`[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2:shortest=1`;
      }
      v+=`,setsar=1,fps=${fps},format=yuv420p,eq=brightness=${c.brightness}:contrast=${c.contrast}:saturation=${c.saturation}`;
      if(c.fade)v+=`,fade=t=in:st=0:d=${Math.min(c.fade,c.duration/2)},fade=t=out:st=${Math.max(0,c.duration-c.fade)}:d=${Math.min(c.fade,c.duration/2)}`;
      if(c.scale!==1)v+=`,scale=${Math.max(2,Math.round(w*c.scale/2)*2)}:${Math.max(2,Math.round(h*c.scale/2)*2)}`;
      filters.push(v+`,setpts=PTS+${c.position}/TB[v${i}]`);
    }
    if(c.media.audio&&!c.track?.muted&&c.volume>0){filters.push(`[${i}:a:0]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,${tempo(c.speed)},volume=${c.volume},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(c.position*1000)}|${Math.round(c.position*1000)}[va${i}]`);mix.push(`[va${i}]`)}
  });
  let base='[base0]',layer=0;
  if(!audioOnly)for(const t of [...tracks].reverse()){
    if(t.hidden)continue;
    if(t.type==='video')clips.forEach((c,i)=>{if(c.trackId!==t.id)return;const next=`[base${++layer}]`;filters.push(`${base}[v${i}]overlay=x=(W-w)*${c.x}:y=(H-h)*${c.y}:eof_action=pass:repeatlast=0:enable='gte(t,${c.position})*lt(t,${c.position+c.duration})'${next}`);base=next});
    if(t.type==='captions'){
      const matches=c=>c.trackId===t.id||(!c.trackId&&t.id===tracks.find(t=>t.type==='captions')?.id);
      const captions=(project.captions||[]).filter(matches),titles=(project.titles||[]).filter(matches);
      if((project.burnCaptions&&captions.length)||titles.length){const name=`captions-${files.length}.ass`;files.push({name,content:ass({...project,captions,titles},w,h)});const next=`[base${++layer}]`;filters.push(`${base}subtitles=${name}${next}`);base=next}
    }
  }
  if(music){filters.push(`[${clips.length}:a:0]aresample=48000,volume=${num(project.musicVolume,0,2,.25)},atrim=duration=${total},asetpts=PTS-STARTPTS[music]`);mix.push('[music]')}
  audioClips.forEach((c,i)=>{if(c.track?.muted||c.volume===0)return;let a=`[${clips.length+(music?1:0)+i}:a:0]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,${tempo(c.speed)},volume=${c.volume},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`;if(c.fadeIn)a+=`,afade=t=in:st=0:d=${Math.min(c.fadeIn,c.duration)}`;if(c.fadeOut)a+=`,afade=t=out:st=${Math.max(0,c.duration-c.fadeOut)}:d=${Math.min(c.fadeOut,c.duration)}`;filters.push(a+`,adelay=${Math.round(c.position*1000)}|${Math.round(c.position*1000)}[a${i}]`);mix.push(`[a${i}]`)});
  const audio=mix.length>1?'[outa]':'[silence]';if(mix.length>1)filters.push(mix.join('')+`amix=inputs=${mix.length}:duration=first:normalize=0,alimiter=limit=0.95:level=false[outa]`);
  args.push('-filter_complex',filters.join(';'));if(!audioOnly)args.push('-map',base);args.push('-map',audio,'-t',String(total));
  const crf=project.quality==='high'?18:project.quality==='small'?28:23;
  if(project.format==='mp3')args.push('-c:a','libmp3lame','-q:a','2');else if(project.format==='wav')args.push('-c:a','pcm_s16le');else if(project.format==='webm')args.push('-c:v','libvpx-vp9','-crf',String(crf+8),'-b:v','0','-deadline','realtime','-cpu-used','5','-c:a','libopus');else args.push('-c:v','libx264','-preset','veryfast','-crf',String(crf),'-c:a','aac','-b:a','192k','-movflags','+faststart');
  args.push('-progress','pipe:1','-nostats',output);return {args,duration:total,width:w,height:h,files,subtitles:ass(project,w,h)};
}
module.exports={renderArgs};
