// Wikimedia was removed at the user's request. Check both index metadata and
// file hosts so old favorites or relayed Openverse results cannot reopen it.
function isWikimediaRecord(r = {}) {
  if ([r.provider, r.source, r.sourceName].some(v => /^(commons|wikimedia(?:_audio)?|wikimedia commons)$/i.test(String(v || '')))) return true;
  return [r.url, r.downloadUrl, r.thumbUrl, r.sourcePageUrl].some(value => {
    try { const host = new URL(value).hostname.toLowerCase(); return ['wikimedia.org', 'wikipedia.org'].some(base => host === base || host.endsWith('.' + base)); } catch { return false; }
  });
}
function assertSourceAllowed(r) {
  if (r?.provider === 'assetpolish') throw Object.assign(Error('AssetPolish has been removed from the online sticker library.'), { code: 'unavailable' });
  if (isWikimediaRecord(r)) throw Object.assign(Error('Wikimedia has been removed from FrameCut’s online library. Files already saved in your projects still work.'), { code: 'unavailable' });
}
const isRemovedRecord = r => r?.provider === 'assetpolish' || isWikimediaRecord(r);
module.exports = { isWikimediaRecord, isRemovedRecord, assertSourceAllowed };
