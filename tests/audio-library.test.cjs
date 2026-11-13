const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Archive}=require('../desktop/providers/archive.cjs');
const {SfxMint}=require('../desktop/providers/sfxmint.cjs');
const {MetadataCache}=require('../desktop/providers/metadata.cjs');
const {Openverse}=require('../desktop/providers/openverse.cjs');
const {musicEvidence,AUDIO_DISCOVERY}=require('../shared/audio-library.mjs');
const cc0='https://creativecommons.org/publicdomain/zero/1.0/';
test('Original Jamendo music has an explicit licensed view; CC0 stays default and Wikimedia stays excluded',async()=>{
 const queries=[];const p=new Openverse({http:{json:async url=>{queries.push(new URL(url));return{results:[{id:'original',title:'Lo-fi Love Song',url:'https://example.org/song.mp3',creator:'Composer',foreign_landing_url:'https://example.org/song',source:'jamendo',license:'by-sa',license_version:'4.0',license_url:'https://creativecommons.org/licenses/by-sa/4.0/',duration:180000,filetype:'mp3'}],result_count:1,page_count:1,page:1};}}});
 await assert.rejects(p.search({kind:'music',source:'jamendo'}),/outside the CC0/);
 const r=await p.search({kind:'music',source:'jamendo',include:'all'});assert.equal(r.items.length,1);assert.equal(r.items[0].license,'by-sa');assert.equal(queries[0].searchParams.get('source'),'jamendo');
 await p.search({kind:'music',include:'credit'});assert.equal(queries[1].searchParams.get('source'),'jamendo','credited music comes from the song catalog, not field recordings');
});
test('Music ranking never deletes eligible records based on sparse tags or title guesses; invalid licenses stay excluded',async()=>{
 const row=(n,title,duration,tags=[],extra={})=>({id:String(n),title,duration,tags:tags.map(name=>({name})),url:'https://example.org/'+n+'.mp3',foreign_landing_url:'https://example.org/track/'+n,source:'freesound',license:'cc0',license_version:'1.0',license_url:cc0,filetype:'mp3',...extra});
 const rows=[row(1,'Cinematic drone 1',60000),row(2,'Peaceful Acoustic 1',90000),row(3,'Untitled by Composer',null),row(4,'Piano melody',60000,['music']),row(5,'Recorded interview',60000,['speech']),row(6,'Mislabeled license',60000,[],{license_url:'https://creativecommons.org/licenses/by/4.0/'})];
 const p=new Openverse({http:{json:async()=>({results:rows,result_count:6,page_count:1,page:1})}});
 const all=await p.search({q:'',kind:'music'});assert.deepEqual(all.items.map(r=>r.sourceId),['4','1','2','3','5']);
 const timed=await p.search({q:'',kind:'music',length:'song'});assert.ok(!timed.items.some(r=>r.sourceId==='3'));
});
test('Every genre retains eligible sparse metadata on every requested page, with explicit techno navigation',async()=>{
 const p=new Openverse({http:{json:async url=>{const u=new URL(url),page=+u.searchParams.get('page'),q=u.searchParams.get('q');return{results:[{id:q+'-'+page,title:'Untitled 2020 session',url:'https://example.org/'+page+'.mp3',foreign_landing_url:'https://example.org/track/'+page,source:'freesound',license:'cc0',license_version:'1.0',license_url:cc0,duration:60000,filetype:'mp3',tags:[]}],result_count:40,page_count:2,page};}}});
 for(const genre of AUDIO_DISCOVERY.genres)for(const page of [1,2]){p.window=[];const r=await p.search({q:genre[2],kind:'music',page});assert.equal(r.items.length,1,genre[1]+' page '+page);}
 for(const id of ['techno','trance','house','edm','dnb','dubstep','chiptune'])assert.ok(AUDIO_DISCOVERY.genres.some(g=>g[0]===id));
 assert.equal(AUDIO_DISCOVERY.genres.find(g=>g[0]==='hiphop')[2],'hip hop','do not add an unnecessary AND term');
});
test('Audio relevance distinguishes musical evidence from spoken recordings; comedy is discoverable',()=>{
 assert.ok(musicEvidence({title:'Funny piano melody',tags:['comedy']}).length);
 assert.deepEqual(musicEvidence({title:'quirky electronic bubbling sound',tags:['boil']}),[]);
 assert.deepEqual(musicEvidence({title:'Piano interview',tags:['music']}),[]);
 assert.deepEqual(musicEvidence({title:'Station noises'}),[]);
 assert.ok(AUDIO_DISCOVERY.moods.some(x=>x[0]==='funny'));
});
test('Archive selects one playable derivative per original and refuses conflicting licenses',()=>{
 const p=new Archive({http:{}});
 const data={metadata:{mediatype:'audio',creator:'Composer',title:'Piano music',licenseurl:cc0},files:[
  {name:'Piano.wav',source:'original',length:'01:05',size:'10000'},
  {name:'Piano.mp3',source:'derivative',original:'Piano.wav',length:'01:05',size:'5000',sha1:'a'.repeat(40)},
  {name:'Tiny.mp3',source:'original',length:3,size:100},
  {name:'Private.mp3',source:'original',length:65,size:500,private:'true'}]};
 let rows=p.records(data,'album'); assert.equal(rows.length,1); assert.equal(rows[0].filetype,'mp3');assert.equal(rows[0].durationMs,65000); assert.equal(rows[0].expectedSha1,'a'.repeat(40));
 data.files[1].licenseurl='https://creativecommons.org/licenses/by/4.0/';
 rows=p.records(data,'album'); assert.equal(rows.length,1); assert.equal(rows[0].filetype,'wav');
 data.metadata.licenseurl=[cc0,'https://creativecommons.org/licenses/by/4.0/'];assert.deepEqual(p.records(data,'album'),[]);
});
test('Archive pages do not skip eligible records after filtering a source batch',async()=>{
 const p=new Archive({http:{}}); p.call=async path=>path.startsWith('/advanced')?{response:{start:0,numFound:3,docs:[{identifier:'a'},{identifier:'b'},{identifier:'c'}]}}:{id:path.split('/').pop()};
 p.records=(d)=>[{sourceId:d.id+'1',durationMs:60000},{sourceId:d.id+'2',durationMs:60000}];
 const a=await p.search({q:'piano',page:1,pageSize:3}),b=await p.search({q:'piano',page:2,pageSize:3});
 assert.deepEqual([...a.items,...b.items].map(r=>r.sourceId),['a1','a2','b1','b2','c1','c2']);
});
test('SFXMint requires MP3 integrity and signal evidence, deduplicates set alternates, honors quota',async()=>{
 let hits=0,key=''; const row={slug:'silly-pop',title:'Silly pop',license:'CC0',mp3_url:'https://sfxmint.com/dl/silly-pop.mp3',duration_ms:2000,format_metadata:{mp3:{duration_ms:500,sha256:'a'.repeat(64),decodable:true,signal_ok:true}}};
 const p=new SfxMint({http:{json:async path=>{hits++; if(path.includes('/sets/'))return {sounds:{pop:{...row,alternates:[row]}}};throw Object.assign(Error('limit'),{status:429,retryAfter:120,body:'{"message":"Daily allowance reached"}'});}},credentials:()=>({key})});
 assert.equal(p.normalize(row,'https://sfxmint.com/api/v1/search').durationMs,500);
 assert.equal(p.normalize({...row,format_metadata:{mp3:{...row.format_metadata.mp3,signal_ok:false}}},''),null);
 const set=await p.search({category:'set:funny'}); assert.equal(set.items.length,1);assert.equal(set.pages,1);
 await assert.rejects(p.call('/search?q=pop'),/Daily allowance/);await assert.rejects(p.call('/search?q=boing'),/Daily allowance/);assert.equal(hits,2,'quota stops different searches too');
 key='sfx_live_new_key';await assert.rejects(p.call('/search?q=pop'),/Daily allowance/);assert.equal(hits,3,'credential change has a separate allowance');
});
test('Archive retries the same catalog page and item after a temporary outage',async()=>{
 const p=new Archive({http:{}});let failSearch=true,failItem=true;const pages=[];
 p.call=async path=>{if(path.startsWith('/advanced')){pages.push(new URL('https://archive.org'+path).searchParams.get('page'));if(failSearch){failSearch=false;throw Error('offline');}return{response:{start:0,numFound:1,docs:[{identifier:'a'}]}};}if(failItem){failItem=false;throw Error('offline');}return{};};
 p.records=()=>[{sourceId:'a',durationMs:60000}];
 await assert.rejects(p.search({q:'piano'}),/offline/);await assert.rejects(p.search({q:'piano'}),/offline/);
 const r=await p.search({q:'piano'});assert.deepEqual(pages,['1','1']);assert.equal(r.items[0].sourceId,'a');
});
test('Metadata cache shares requests, backs off failures including synchronous errors, and stays bounded',async()=>{
 const c=new MetadataCache(null,{maxEntries:2});let hits=0;
 await Promise.all([c.get('a',async()=>{hits++;return 1;}),c.get('a',async()=>{hits++;return 2;})]);assert.equal(hits,1);
 await assert.rejects(c.get('bad',()=>{throw Error('offline');}),/offline/);assert.equal(c.inflight.size,0);
 c.set('b',2);c.set('c',3);assert.equal(c.entries.size,2);assert.equal(c.entries.has('a'),false);
});
