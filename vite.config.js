import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import fs from 'node:fs';
import path from 'node:path';
// ONNX runtime files for the local Whisper caption engine are copied next to the build.
export default defineConfig({
  base: '/', plugins: [preact(), { name: 'copy-onnx-runtime', closeBundle() { const source = path.resolve('node_modules/onnxruntime-web/dist'), dest = path.resolve('dist/ort'); fs.mkdirSync(dest, { recursive: true }); for (const name of fs.readdirSync(source)) if (name.endsWith('.wasm') || name.endsWith('.mjs')) fs.copyFileSync(path.join(source, name), path.join(dest, name)); } }],
  build: { target: 'esnext', chunkSizeWarningLimit: 3000 }, worker: { format: 'es' },
  server: { proxy: { '/api': 'http://127.0.0.1:5199', '/media': 'http://127.0.0.1:5199', '/proxy': 'http://127.0.0.1:5199', '/cache': 'http://127.0.0.1:5199', '/fonts': 'http://127.0.0.1:5199' } },
});
