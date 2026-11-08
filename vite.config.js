import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
export default defineConfig({base:'/',build:{target:'esnext',chunkSizeWarningLimit:3000},worker:{format:'es'},plugins:[{name:'copy-onnx-runtime',closeBundle(){const source=path.resolve('node_modules/onnxruntime-web/dist'),dest=path.resolve('dist/ort');fs.mkdirSync(dest,{recursive:true});for(const name of fs.readdirSync(source))if(name.endsWith('.wasm')||name.endsWith('.mjs'))fs.copyFileSync(path.join(source,name),path.join(dest,name));}}]});
