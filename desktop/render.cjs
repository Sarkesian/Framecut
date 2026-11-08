const ratios = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '4:3': [4, 3], '21:9': [21, 9], '2:1':[2,1], '3:4':[3,4], '1.85:1':[1.85,1], '2.35:1':[2.35,1] };
const num = (v, min, max, fallback) => Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : fallback;
function dimensions(ratio, resolution) {
  const [a, b] = ratios[ratio] || ratios['16:9'];
  const short = [480, 720, 1080, 2160].includes(+resolution) ? +resolution : 1080;
  return a >= b ? [Math.round(short * a / b / 2) * 2, short] : [short, Math.round(short * b / a / 2) * 2];
}
function normalize(project, assets) {
  if (!Array.isArray(project.clips) || (!project.clips.length&&!project.audioClips?.length)) throw Error('Add a video or audio clip.');
  return project.clips.map(c => {
    const media = assets.get(c.mediaId);
    if (!media || !media.video) throw Error('A clip is missing its video. Reimport the original file.');
    const start = num(c.start, 0, media.duration, 0), end = num(c.end, 0, media.duration, media.duration);
    if (end - start < .05) throw Error('Each clip must be at least 0.05 seconds long.');
    const speed = num(c.speed, .25, 4, 1);
    return { ...c, media, start, end, speed, duration: (end - start) / speed, volume: num(c.volume, 0, 2, 1), fade: num(c.fade, 0, 2, 0), brightness: num(c.brightness, -.5, .5, 0), contrast: num(c.contrast, .5, 2, 1), saturation: num(c.saturation, 0, 2, 1) };
  });
}
function tempo(speed) { const parts = []; while (speed > 2) { parts.push('atempo=2'); speed /= 2; } while (speed < .5) { parts.push('atempo=0.5'); speed *= 2; } parts.push(`atempo=${speed}`); return parts.join(','); }
function assTime(seconds) { const cs = Math.max(0, Math.round(seconds * 100)); return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`; }
function safeText(s) { return String(s || '').replace(/\\/g, '\uFF3C').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N').slice(0, 4000); }
function ass(project, w, h) {
  const size = Math.round(h * num(project.captionSize, .025, .1, .052));
  const font=String(project.captionFont||'Arial').replace(/[,\r\n{}\\]/g,'').slice(0,100);
  const alignment={bottom:2,middle:5,top:8}[project.captionPosition]||2;
  const bold=project.captionBold===false?0:-1,italic=project.captionItalic?-1:0;
  const outline=num(project.captionOutline,0,10,3)*h/1080;
  const boxed=project.captionBox||project.captionPreset==='boxed';
  const style=`Style: Default,${font},${size},${assColorPlaceholder()},&H00FFFFFF,${boxed?'&H90000000':'&H00101010'},&H90000000,${bold},${italic},0,0,100,100,0,0,${boxed?3:1},${boxed?Math.round(h*.012):outline},${project.captionShadow?Math.round(h*.003):0},${alignment},${Math.round(w*.06)},${Math.round(w*.06)},${Math.round(h*.08)},1`;
  function assColorPlaceholder(){return '__CAPTION_PRIMARY_COLOR__'}
  const color = (project.captionColor || '#ffffff').replace('#','');
  const rgb = /^[0-9a-f]{6}$/i.test(color) ? color : 'ffffff';
  const assColor = `&H00${rgb.slice(4,6)}${rgb.slice(2,4)}${rgb.slice(0,2)}`;
  let text = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${size},${assColor},&H000000FF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,${Math.max(2,h/400)},0,2,${Math.round(w*.06)},${Math.round(w*.06)},${Math.round(h*.08)},1\nStyle: Title,Arial,${Math.round(h*.065)},&H00FFFFFF,&H000000FF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,3,0,8,40,40,${Math.round(h*.08)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  text=text.replace(/^Style: Default,.*$/m,style.replace('__CAPTION_PRIMARY_COLOR__',assColor));
  for (const c of (project.burnCaptions ? project.captions || [] : [])) if (+c.end > +c.start) {
    let caption=safeText(project.captionUppercase?c.text.toUpperCase():c.text);
    if(project.captionPreset==='highlight'&&c.words?.length){
      let cursor=+c.start;
      caption=c.words.map(word=>{const gap=Math.max(0,Math.round((word.start-cursor)*100));const length=Math.max(1,Math.round((word.end-word.start)*100));cursor=word.end;return (gap?`{\\k${gap}}`:'')+`{\\k${length}}`+safeText(project.captionUppercase?word.text.toUpperCase():word.text)}).join(' ');
    }
    text += `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${caption}\n`;
  }
  for (const c of project.titles || []) if (+c.end > +c.start) text += `Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Title,,0,0,0,,${safeText(c.text)}\n`;
  return text;
}
function renderArgs(...args){return require('./composition.cjs').renderArgs(...args)}
module.exports={dimensions,normalize,tempo,ass,renderArgs,num};
