// Own the complete stream lifecycle. pipeline observes asynchronous write errors,
// handles backpressure and closes every stream before a caller removes a partial file.
const fs = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
async function writeStreamedFile(input, file, { signal, maxBytes = 300 * 1024 ** 2, onChunk } = {}) {
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(Object.assign(Error('This file is too large to download.'), { code: 'size' }));
    try {
      const pending = onChunk?.(chunk, bytes);
      if (pending?.then) pending.then(() => callback(null, chunk), callback);
      else callback(null, chunk);
    } catch (error) { callback(error); }
  } });
  await pipeline(input, meter, fs.createWriteStream(file), { signal });
  return { bytes };
}
module.exports = { writeStreamedFile };
