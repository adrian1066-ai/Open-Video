const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
if(!process.env.OPENVIDEO_TEST_USERS_PATH)throw Error('Set OPENVIDEO_TEST_USERS_PATH to a private JSON file containing two test accounts (host first, viewer second). Never commit credentials.');
const users=JSON.parse(fs.readFileSync(process.env.OPENVIDEO_TEST_USERS_PATH));
const root=path.resolve(__dirname,'..');
const output=fs.mkdtempSync(path.join(require('os').tmpdir(),'openvideo-browser-'));
const key=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/SUPABASE_PUBLISHABLE_KEY='([^']+)/)[1];
const base='https://ummcwmbsrsevwrdidprl.supabase.co';
const server=http.createServer((req,res)=>{const f=path.join(root,decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!f.startsWith(root)){res.writeHead(403);return res.end();}try{res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(f));}catch{res.writeHead(404);res.end();}});
const assert=(v,m)=>{if(!v)throw Error(m)};
(async()=>{
 await new Promise(r=>server.listen(4173,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 const errors=[];let cleanup=async()=>{};
 try{
  const contexts=await Promise.all(users.map(()=>browser.newContext({viewport:{width:1440,height:1000},permissions:['camera','microphone']})));
  for(const context of contexts)await context.addInitScript(()=>{const Native=window.RTCPeerConnection;window.__peers=[];window.RTCPeerConnection=class extends Native{constructor(...a){super(...a);window.__peers.push(this);}};});
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  for(let i=0;i<pages.length;i++){
   const p=pages[i],u=users[i];p.on('pageerror',e=>errors.push(e.message));
   await p.goto(process.env.OPENVIDEO_TEST_URL||'http://127.0.0.1:4173');await p.waitForFunction(()=>typeof sb!=='undefined');
   const login=await p.evaluate(async u=>{const {data,error}=await sb.auth.signInWithPassword({email:u.email,password:u.password});if(error)return {error:error.message};authUser=data.user;const channel=await ensureChannel();return {ok:true,channelId:channel.id};},u);
   assert(login.ok,'Test login failed: '+login.error);u.channelId=login.channelId;
  }
  const [host,viewer]=pages;
  await viewer.setViewportSize({width:390,height:844});
  const api=(page,action,params={})=>page.evaluate(async({action,params})=>{const {data:{session}}=await sb.auth.getSession();const r=await fetch(SUPABASE_URL+'/functions/v1/openvideo-live',{method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,...params})});return {status:r.status,data:await r.json()};},{action,params});
  const community=(page,module,action,data={})=>page.evaluate(({module,action,data})=>OpenVideoCommunity.api(module,action,data),{module,action,data});
  let request,event,entry,followedBefore=true;
  if(process.env.OPENVIDEO_CHALLENGE_ID){
   entry=await community(host,'challenge','accept',{id:process.env.OPENVIDEO_CHALLENGE_ID});
   request=await community(viewer,'request','create',{title:'Automated Live request verification',country:'Mexico',city:'Test city',deadline:new Date(Date.now()+3600000).toISOString()});await community(host,'request','accept',{id:request.id});
   event=await community(host,'event','create',{title:'Automated Live event verification',topic:'Technology'});
   followedBefore=await viewer.evaluate(async id=>{const {data,error}=await sb.rpc('get_channel_follow_state_v68',{p_channel_id:id});if(error)throw error;if(!data.followed){const r=await sb.rpc('toggle_channel_follow_v68',{p_channel_id:id});if(r.error)throw r.error;}return data.followed;},users[0].channelId);
   cleanup=async()=>{await community(host,'request','cancel',{id:request.id}).catch(()=>{});await community(host,'event','close',{id:event.id}).catch(()=>{});if(!followedBefore)await viewer.evaluate(async id=>{const {data}=await sb.rpc('get_channel_follow_state_v68',{p_channel_id:id});if(data?.followed)await sb.rpc('toggle_channel_follow_v68',{p_channel_id:id});},users[0].channelId);};
  }
  if(process.env.LIVE_TEST_RECOVERY==='1')await host.route('**/storage/v1/object/upload/sign/live-replays/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Simulated upload outage"}'}));
  await host.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');
   const draw=()=>{ctx.fillStyle='#15345e';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='30px sans-serif';ctx.fillText('OpenVideo verification '+Date.now(),20,180);};draw();
   const stream=canvas.captureStream(15);const timer=setInterval(draw,60);
   const audio=new AudioContext(),osc=audio.createOscillator(),dest=audio.createMediaStreamDestination();osc.connect(dest);osc.start();await audio.resume();
   stream.addTrack(dest.stream.getAudioTracks()[0]);window.__testMedia={canvas,audio,osc,timer,stream};return stream;
  };});
  await host.evaluate(()=>go('live'));await host.fill('#liveTitle','OpenVideo automated verification');
  await host.fill('#liveCategory','Technology');await host.fill('#liveCountry','Mexico');await host.fill('#liveCity','Test city');
  await host.click('#liveStart');
  await host.waitForFunction(()=>document.getElementById('liveBroadcastStatus').textContent.includes('You are live'),{},{timeout:60000});
  console.log('PASS: WHIP connected with synthetic camera/audio');
  const liveId=await host.evaluate(async()=>{const {data:{session}}=await sb.auth.getSession();const r=await fetch(SUPABASE_URL+'/functions/v1/openvideo-live',{method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'list'})});return(await r.json()).sessions.find(s=>s.title==='OpenVideo automated verification').id;});
  const listing=(await api(viewer,'list')).data.sessions.find(s=>s.id===liveId);
  assert(listing.category==='Technology'&&listing.country==='Mexico'&&listing.city==='Test city'&&listing.started_at,'Live metadata missing');
  if(entry){
   await host.evaluate(()=>go('challenges'));await host.waitForFunction(id=>!!document.getElementById('proof-'+id),entry.id);await host.selectOption('#proof-'+entry.id,liveId);await host.locator(`[data-challenge-submit="${entry.id}"]`).click();await host.waitForFunction(()=>document.getElementById('challengeHistory').textContent.includes('submitted'));await host.evaluate(()=>go('live'));
   await community(host,'request','start',{id:request.id,live_id:liveId});await community(host,'event','join',{id:event.id,live_id:liveId});
   await viewer.evaluate(()=>go('notifications'));await viewer.click('#notificationRefresh');await viewer.waitForFunction(()=>document.getElementById('notificationList').textContent.includes('is live'));
   await viewer.evaluate(()=>go('live-map'));await viewer.locator(`[data-map-live="${liveId}"]`).waitFor();assert((await viewer.locator('#mapLives').textContent()).includes('Mexico'),'Map metadata missing');
   await viewer.evaluate(()=>go('multiview'));await viewer.locator(`[data-event-watch="${event.id}"]`).click();await viewer.waitForFunction(()=>document.getElementById('livePlayer').videoWidth>0,{},{timeout:30000});assert(await viewer.evaluate(()=>window.__peers.filter(p=>p.connectionState!=='closed').length===1),'Multi-View created duplicate playback connections');
   console.log('PASS: actual Live challenge proof, request association, follower notification, map and event perspective');
  }
  await viewer.evaluate(id=>OpenVideoLive.open(id),liveId);
  try{await viewer.waitForFunction(()=>document.getElementById('livePlayer').videoWidth>0,{},{timeout:25000});}
  catch(e){for(const p of pages)console.dir(await p.evaluate(async()=>({status:document.getElementById('liveWatchStatus').textContent,broadcast:document.getElementById('liveBroadcastStatus').textContent,tracks:[...(document.getElementById('livePlayer').srcObject?.getTracks()||[])].map(t=>({kind:t.kind,muted:t.muted,readyState:t.readyState})),peers:await Promise.all(window.__peers.map(async pc=>({connection:pc.connectionState,ice:pc.iceConnectionState,stats:[...await pc.getStats()].map(x=>x[1]).filter(x=>['inbound-rtp','outbound-rtp','codec'].includes(x.type)).map(x=>({kind:x.kind,mimeType:x.mimeType,codecId:x.codecId,sdpFmtpLine:x.sdpFmtpLine,bytesSent:x.bytesSent,bytesReceived:x.bytesReceived,framesDecoded:x.framesDecoded,framesEncoded:x.framesEncoded}))})))})),{depth:null});throw e;}
  console.log('PASS: WHEP received video');
  await viewer.waitForFunction(async()=>{for(const pc of window.__peers){for(const report of (await pc.getStats()).values()){if(report.type==='inbound-rtp'&&report.kind==='audio'&&report.bytesReceived>0)return true;}}return false;},{},{timeout:15000});
  console.log('PASS: WHEP received audio packets');
  await viewer.fill('#liveMessage','Verified live chat');await viewer.click('#liveSend');
  await viewer.waitForFunction(()=>document.getElementById('liveChat').textContent.includes('Verified live chat'));
  await viewer.click('#liveLike');await viewer.waitForFunction(()=>document.getElementById('liveLike').textContent.includes('♥'));
  console.log('PASS: persisted chat, likes and viewer heartbeat');
  assert((await api(viewer,'state',{liveId})).data.viewers>=1,'Viewer presence was not counted');
  await viewer.screenshot({path:path.join(output,'live-watch.png')});
  await host.waitForTimeout(32000);
  await host.click('#liveStop');
  await host.waitForFunction(()=>/replay is ready|Recover recordings|temporarily|failed/.test(document.getElementById('liveBroadcastStatus').textContent),{},{timeout:60000});
  const endStatus=await host.locator('#liveBroadcastStatus').textContent();console.log('Replay result:',endStatus);
  if(process.env.LIVE_TEST_RECOVERY==='1'){
   assert(endStatus.includes('Recover recordings'),'Failed uploads were not retained for recovery');
   await host.unroute('**/storage/v1/object/upload/sign/live-replays/**');await host.click('#liveRecover');
   await host.waitForFunction(()=>document.getElementById('liveBroadcastStatus').textContent.includes('Saved recordings recovered'),{},{timeout:60000});
   console.log('PASS: recording recovery after interrupted upload');
  }else assert(endStatus.includes('replay is ready'),'Replay did not finalize');
  assert(!(await api(viewer,'list')).data.sessions.some(s=>s.id===liveId),'Ended session remained in active discovery');
  assert(!(await api(viewer,'replays')).data.sessions.some(s=>s.id===liveId),'Private replay was auto-published');
  for(const action of ['replay','replay-segment'])assert((await api(viewer,action,{liveId,ordinal:0})).status===403,'Viewer accessed private recording');
  assert((await api(host,'replay',{liveId})).status===200,'Owner cannot review draft');
  console.log('PASS: stop removes live; saved replay is private; owner can review');
  if(request){await community(host,'request','complete',{id:request.id});assert((await community(viewer,'request','list')).requests.find(r=>r.id===request.id).status==='completed','Request lifecycle did not complete');console.log('PASS: request completed after real Live ended');}
  await host.locator(`[data-publish="${liveId}"]`).click();
  await host.waitForFunction(id=>document.querySelector(`[data-publish="${id}"]`)?.textContent.includes('Unpublish'),liveId);
  assert((await api(viewer,'replays')).data.sessions.some(s=>s.id===liveId),'Explicitly published replay not discoverable');
  await viewer.evaluate(id=>OpenVideoLive.open(id,true),liveId);
  await viewer.waitForFunction(()=>document.getElementById('livePlayer').videoWidth>0&&document.getElementById('liveWatchStatus').textContent.includes('Replay · part'),{},{timeout:30000});
  const count=await viewer.locator('#liveSegments option').count();assert(count>=2,'Expected multiple replay segments');
  await viewer.selectOption('#liveSegments','1');await viewer.waitForFunction(()=>document.getElementById('liveWatchStatus').textContent.includes('part 2'));
  console.log('PASS: parallel recording uploaded, finalized and replayed, including part 2');
  await viewer.setViewportSize({width:390,height:844});await viewer.screenshot({path:path.join(output,'live-watch-mobile.png')});
  assert(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile viewport overflow');
  console.log('PASS: mobile layout');
  await host.locator(`[data-publish="${liveId}"]`).click();
  await host.waitForFunction(id=>document.querySelector(`[data-publish="${id}"]`)?.textContent==='Publish replay',liveId);
  assert((await api(viewer,'replay-segment',{liveId,ordinal:0})).status===403,'Unpublish failed');
  console.log('PASS: creator publication and unpublication; private test replay preserved');
  await host.fill('#liveTitle','OpenVideo no-recording verification');await host.uncheck('#liveRecord');
  await host.click('#liveStart');await host.waitForFunction(()=>document.getElementById('liveBroadcastStatus').textContent.includes('recording is off'),{},{timeout:60000});
  await host.click('#liveStop');await host.waitForFunction(()=>document.getElementById('liveBroadcastStatus').textContent.includes('no replay was recorded'),{},{timeout:30000});
  console.log('PASS: optional recording off still supports live and clean shutdown');
  assert(!errors.length,'Browser errors: '+errors.join('; '));
 }finally{await cleanup();await browser.close();server.close();}
})().catch(e=>{console.error('FAIL:',e.message);server.close();process.exitCode=1;});
