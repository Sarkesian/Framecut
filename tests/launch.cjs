// Starts FrameCut for the end-to-end journeys: the source tree by default, or an installed build when
// FRAMECUT_EXE points at its "FrameCut Studio.exe" (used to verify real packaged builds).
const path = require('node:path');
const { _electron: electron } = require('playwright');
function launchApp(env = process.env) {
  const exe = process.env.FRAMECUT_EXE;
  return exe ? electron.launch({ executablePath: exe, args: [], env }) : electron.launch({ args: [path.resolve('.')], env });
}
module.exports = { launchApp };
