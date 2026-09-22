// Real-service regression test. Dedicated accounts only; credentials stay outside this repository.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const users=JSON.parse(fs.readFileSync(process.env.OPENVIDEO_TEST_USERS_PATH));
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403);return res.end();}try{res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(p));}catch{res.writeHead(404);res.end();}});
(async()=>{
 await new Promise(r=>server.listen(4174,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 let host,videoId;
 try{
 const pages=[];const errors=[];
 for(const u of users){const context=await browser.newContext();const p=await context.newPage();p.on('pageerror',e=>{errors.push(e.message);console.log('Browser error:',e.message)});p.on('requestfailed',r=>console.log('Request failed:',new URL(r.url()).hostname,r.failure()?.errorText));await p.goto('http://127.0.0.1:4174');await p.waitForFunction(()=>!!window.supabase);const ok=await p.evaluate(async u=>{const {data,error}=await sb.auth.signInWithPassword(u);authUser=data.user;await ensureChannel();return !error;},{email:u.email,password:u.password});assert(ok,'Login failed');pages.push(p);}
 [host]=pages;const viewer=pages[1];
 const permissions=await host.evaluate(async()=>({roleDenied:!!(await sb.from('profiles').update({is_admin:true}).eq('id',authUser.id)).error,profileEditable:!(await sb.from('profiles').update({display_name:authUser.user_metadata.display_name||'Verification host'}).eq('id',authUser.id)).error,channelDenied:!!(await sb.from('channels').update({subscriber_count:999}).eq('owner_id',authUser.id)).error}));
 assert(permissions.roleDenied&&permissions.channelDenied&&permissions.profileEditable,'Column permissions regression');
 console.log('PASS: role/count escalation denied; profile editing preserved');
 const bytes=await host.evaluate(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');const timer=setInterval(()=>{x.fillStyle='#123456';x.fillRect(0,0,320,180);x.fillStyle='white';x.fillText('OpenVideo test '+Date.now(),10,40);},40);const stream=c.captureStream(15),parts=[],r=new MediaRecorder(stream,{mimeType:'video/webm'});const blob=await new Promise(resolve=>{r.ondataavailable=e=>parts.push(e.data);r.onstop=()=>resolve(new Blob(parts,{type:'video/webm'}));r.start();setTimeout(()=>r.stop(),1200);});clearInterval(timer);stream.getTracks().forEach(t=>t.stop());return [...new Uint8Array(await blob.arrayBuffer())];});
 await host.evaluate(()=>go('upload'));await host.setInputFiles('#realVideoFile',{name:'regression.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)});await host.fill('#uploadTitle','OpenVideo regression fixture');await host.selectOption('#uploadVisibility','public');await host.click('#realPublishBtn');await host.waitForFunction(()=>current?.real&&current?.title==='OpenVideo regression fixture');videoId=await host.evaluate(()=>current.video_id);
 await host.waitForFunction(()=>document.getElementById('realVideoPlayer').videoWidth>0);
 console.log('PASS: real video upload, metadata insert and signed playback');
 await viewer.evaluate(async id=>{await loadPublicCommunityVideos();await watchCommunityVideo(id);},videoId);await viewer.waitForFunction(()=>document.getElementById('realVideoPlayer').videoWidth>0);console.log('PASS: second account video playback');
 await viewer.fill('#commentInput','Regression comment');await viewer.evaluate(()=>addRealComment());await viewer.waitForFunction(()=>document.getElementById('comments').textContent.includes('Regression comment'));
 console.log('PASS: second account comment');
 await host.evaluate(()=>go('notifications'));await host.click('#notificationRefresh');await host.waitForFunction(()=>document.getElementById('notificationList').textContent.includes('Regression comment'));
 const notification=await host.evaluate(async id=>{const {data,error}=await sb.from('notifications').select('id').eq('route','real-'+id).eq('type','comment').limit(1);if(error)throw error;return data[0];},videoId);assert(notification,'Comment notification missing');
 const isolation=await viewer.evaluate(async id=>{const read=await sb.from('notifications').select('id').eq('id',id);const write=await sb.from('notifications').update({read:true}).eq('id',id).select('id');const forge=await sb.from('notifications').insert({user_id:authUser.id,type:'fake',title:'fake'});return{rows:read.data,changed:write.data,forbidden:!!forge.error};},notification.id);assert.deepEqual(isolation,{rows:[],changed:[],forbidden:true},'Notification isolation failed');
 await host.locator(`[data-notification-read="${notification.id}"]`).click();await host.waitForFunction(id=>!document.querySelector(`[data-notification-read="${id}"]`),notification.id);
 console.log('PASS: real comment inbox, mark read, cross-user isolation and forged notification denial');
 await viewer.evaluate(()=>toggleRealLike());await viewer.waitForFunction(()=>liked===true);await viewer.evaluate(()=>toggleRealLike());await viewer.waitForFunction(()=>liked===false);console.log('PASS: second account like/unlike');
 await viewer.evaluate(async()=>{await loadRealFollowState(current.channel_id);if(!followed)await toggleRealFollow();});await viewer.waitForFunction(()=>followed===true);await viewer.evaluate(()=>openFollowingFeed());await viewer.waitForFunction(()=>document.getElementById('view-following').textContent.includes('OpenVideo regression fixture'));
 await viewer.evaluate(async id=>{await watchCommunityVideo(id);await toggleRealFollow();},videoId);await viewer.waitForFunction(()=>followed===false);
 console.log('PASS: comment, like/unlike, follow/unfollow and Following feed');
 await viewer.evaluate(()=>openReport());await viewer.fill('#safetyDescription','Automated regression fixture — no actual abuse.');await viewer.click('#safetySubmit');await viewer.waitForFunction(()=>document.getElementById('safetyReportStatus').textContent.includes('Report received'));await viewer.click('#safetyCancel');
 const hostId=await host.evaluate(()=>authUser.id);await viewer.evaluate(id=>OpenVideoSafety.blockUser(id),hostId);await viewer.locator('[data-unblock]').first().waitFor();
 const blocked=await viewer.evaluate(async id=>(await sb.from('videos').select('id').eq('id',id)).data,videoId);assert.equal(blocked.length,0,'Blocked creator video remained readable');
 await viewer.locator(`[data-unblock="${hostId}"]`).click();await viewer.waitForFunction(()=>document.getElementById('safetyBlocks').textContent.includes('No blocked users'));
 const visible=await viewer.evaluate(async id=>(await sb.from('videos').select('id').eq('id',id)).data,videoId);assert.equal(visible.length,1,'Unblock did not restore access');
 const denied=await viewer.evaluate(async()=>{const {data:{session}}=await sb.auth.getSession();return(await fetch(SUPABASE_URL+'/functions/v1/openvideo-safety',{method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'queue'})})).status;});assert.equal(denied,403,'Ordinary user accessed moderation queue');
 console.log('PASS: real report submission, block/unblock, RLS filtering and moderator access denial');
 await viewer.evaluate(()=>{searchInput.value='not-a-real-result-987654';searchNow();});assert((await viewer.locator('#exploreGrid').textContent()).includes('No matching videos'),'Search must not replace zero results with demos');
 for(const route of ['home','explore','following','studio','auth','live','notifications','safety']){await viewer.evaluate(r=>go(r),route);await viewer.locator('#view-'+route).waitFor({state:'visible'});}
 await viewer.setViewportSize({width:390,height:844});await viewer.evaluate(()=>go('live'));assert(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow');
 assert.equal(errors.length,0,errors.join('; '));console.log('PASS: real search empty state, navigation, mobile and no browser exceptions');
 }finally{
 if(host&&videoId)await host.evaluate(async id=>{const {error}=await sb.from('videos').update({visibility:'private'}).eq('id',id);if(error)throw Error('Could not make regression fixture private');},videoId);
 await browser.close();server.close();
 }
})().catch(e=>{console.error('FAIL:',e.message);server.close();process.exitCode=1;});
