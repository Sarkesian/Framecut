const {test}=require('node:test');const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {startServer}=require('../desktop/server.cjs');
test('Compatible provider verifies credentials, lists models, and swaps text models',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'framecut-api-'));let service;const seen=[];
 const mock=http.createServer(async(req,res)=>{if(req.headers.authorization!=='Bearer test-key'){res.writeHead(401);return res.end('{}')}res.setHeader('Content-Type','application/json');if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'local-text-one'},{id:'local-text-two'}]}));if(req.url==='/v1/chat/completions'){let body='';for await(const c of req)body+=c;const request=JSON.parse(body);seen.push(request);return res.end(JSON.stringify({choices:[{message:{content:'An original video title'}}]}))}res.writeHead(404);res.end('{}')});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 try{
  service=await startServer({dataDir:temp});
  const request=(url,body)=>fetch(service.url+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const cfg={baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,key:'wrong',model:'local-text-one'};
  assert.equal((await request('/api/ai/verify',cfg)).status,400);cfg.key='test-key';
  const verified=await(await request('/api/ai/verify',cfg)).json();assert.equal(verified.models.length,2);
  const text=await(await request('/api/ai/text',{task:'Suggest a title',text:'A transcript'})).json();assert.equal(text.text,'An original video title');
  cfg.model='local-text-two';await request('/api/ai/config',cfg);await request('/api/ai/text',{task:'Summarize',text:'Second transcript'});
  assert.equal(seen[0].model,'local-text-one');assert.equal(seen[1].model,'local-text-two');assert.ok(seen[1].messages[1].content.includes('Second transcript'));
 }finally{service?.close();mock.close();await fs.rm(temp,{recursive:true,force:true})}
});
