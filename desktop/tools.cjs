// FFmpeg/FFprobe helpers shared by the server, background workers and tests.
const path = require('node:path');
const { spawn } = require('node:child_process');

const unpack = p => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const ffmpeg = unpack(require('ffmpeg-static'));
const ffprobe = unpack(require('ffprobe-static').path);

// Run a binary; resolves {out, err}. options.encoding='buffer' keeps stdout binary. options.signal aborts.
function run(binary, args, options = {}) {
  const { encoding, signal, onStdout, onStderr, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, ...spawnOptions });
    const chunks = []; let size = 0, err = '';
    child.stdout.on('data', d => { onStdout?.(d); if (size < 400e6) { chunks.push(d); size += d.length; } });
    child.stderr.on('data', d => { onStderr?.(d); err = (err + d).slice(-20000); });
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(Object.assign(Error('Cancelled'), { cancelled: true }));
      const buf = Buffer.concat(chunks), out = encoding === 'buffer' ? buf : buf.toString('utf8');
      code === 0 ? resolve({ out, err }) : reject(Error(friendlyError(err) || `The video tool stopped unexpectedly (code ${code}).`));
    });
  });
}

function friendlyError(log) {
  const s = String(log || '');
  if (/No such file or directory/i.test(s)) return 'A media file could not be found. It may have been moved or deleted.';
  if (/Invalid data found when processing input/i.test(s)) return 'A media file is damaged or uses a format FrameCut cannot read.';
  if (/No space left on device/i.test(s)) return 'The disk is full. Free some space or choose another export location.';
  if (/Permission denied/i.test(s)) return 'FrameCut does not have permission to write there. Choose another folder.';
  if (/OpenEncodeSessionEx failed|No capable devices found|Cannot load nvcuda|amfrt64|MFX session/i.test(s)) return 'Hardware encoding is unavailable right now. Turn off hardware acceleration and export again.';
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(frame=|size=|Press \[q\]|\s*Stream|\s*Metadata|\s*Duration)/.test(l));
  return lines.slice(-3).join('\n');
}

const IMAGE_CODECS = new Set(['mjpeg', 'png', 'webp', 'bmp', 'tiff', 'gif', 'jpegls', 'jpeg2000', 'svg']);
async function probeMedia(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.svg') return { kind: 'image', video: true, audio: false, duration: 5, width: 1000, height: 1000, svg: true };
  const data = JSON.parse((await run(ffprobe, ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', file])).out);
  const video = data.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = data.streams.find(s => s.codec_type === 'audio');
  let duration = +(data.format?.duration || video?.duration || audio?.duration || 0);
  const frames = +(video?.nb_frames || 0);
  const isImage = video && IMAGE_CODECS.has(video.codec_name) && !audio && (frames <= 1 || /image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe/.test(data.format?.format_name || '')) && !(video.codec_name === 'gif' && duration > 0.2);
  if (!video && !audio) throw Error('This file has no video or audio FrameCut can use.');
  if (isImage) return { kind: 'image', video: true, audio: false, duration: 5, width: video.width, height: video.height };
  if (!Number.isFinite(duration) || duration <= 0) throw Error('This file has no playable duration.');
  let width = video?.width || 0, height = video?.height || 0;
  const rotation = Math.abs(+(video?.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0)) % 180;
  if (rotation === 90) [width, height] = [height, width];
  const fr = String(video?.avg_frame_rate || video?.r_frame_rate || '0/1').split('/').map(Number);
  return {
    kind: video ? 'video' : 'audio', video: !!video, audio: !!audio, duration, width, height,
    fps: fr[1] ? +(fr[0] / fr[1]).toFixed(3) : 0, vcodec: video?.codec_name || null, acodec: audio?.codec_name || null,
    alpha: /yuva|rgba|argb|bgra/.test(video?.pix_fmt || '') || video?.tags?.alpha_mode === '1' || video?.tags?.ALPHA_MODE === '1',
    sampleRate: +(audio?.sample_rate || 0), channels: +(audio?.channels || 0), bitrate: +(data.format?.bit_rate || 0),
  };
}

let encoderCache;
async function detectEncoders() {
  if (encoderCache) return encoderCache;
  const tryEnc = async enc => { try { await run(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x144:d=0.2', '-c:v', enc, '-f', 'null', '-'], {}); return true; } catch { return false; } };
  const [nvenc, nvencHevc, amf, qsv] = await Promise.all([tryEnc('h264_nvenc'), tryEnc('hevc_nvenc'), tryEnc('h264_amf'), tryEnc('h264_qsv')]);
  encoderCache = { nvenc: nvenc && nvencHevc, amf, qsv, preferred: nvenc ? 'nvenc' : amf ? 'amf' : qsv ? 'qsv' : null };
  return encoderCache;
}

module.exports = { run, ffmpeg, ffprobe, probeMedia, detectEncoders, friendlyError };
