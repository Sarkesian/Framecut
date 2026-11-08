import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = '/ort/';
env.backends.onnx.wasm.numThreads = 1;
let transcriber;
let lastProgress = 0;
self.onmessage = async ({data}) => {
  try {
    transcriber ||= await pipeline('automatic-speech-recognition','onnx-community/whisper-base_timestamped',{dtype:'q8',device:'wasm',progress_callback:p=>{
      if (Date.now() - lastProgress < 250) return;
      lastProgress = Date.now();
      self.postMessage({type:'progress',message:p.status==='progress'?`Downloading speech model: ${Math.round(p.progress || 0)}%`:'Preparing local speech model…'});
    }});
    self.postMessage({type:'progress',message:'Transcribing on your computer…'});
    const result=await transcriber(data.audio,{chunk_length_s:30,stride_length_s:5,return_timestamps:'word',task:'transcribe',...(data.language?{language:data.language}:{})});
    self.postMessage({type:'done',result});
  }catch(error){self.postMessage({type:'error',message:error.message})}
};
