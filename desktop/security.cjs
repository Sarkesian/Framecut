// Compare parsed origins, never URL prefixes (a longer port/host can share a prefix).
function sameOrigin(candidate, base) {
  try { return new URL(candidate).origin === new URL(base).origin; } catch { return false; }
}
module.exports = { sameOrigin };
