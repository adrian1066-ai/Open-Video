/* Live extends the existing application and uses its Supabase client, account and channel UI. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const escape=value=>escapeHtml(String(value??''));
  const endpoint=SUPABASE_URL+'/functions/v1/openvideo-live';
  let guest=sessionStorage.getItem('openvideo-live-viewer');
  if(!guest){guest=crypto.randomUUID();sessionStorage.setItem('openvideo-live-viewer',guest);}
  let broadcast=null,watching=null,liked=false,loading=false,watchGeneration=0;
  let discoverTimer=null;
  const errorMessage=e=>e?.message||'Live is temporarily unavailable.';
  async function api(action,data={}) {
    const {data:{session}}=await sb.auth.getSession();
    const headers={'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY};
    if(session)headers.Authorization=`Bearer ${session.access_token}`;
    const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({action,viewerId:guest,...data}),signal:AbortSignal.timeout(25000)});
    const result=await r.json();if(!r.ok){const error=new Error(result.error||'Live request failed.');error.status=r.status;throw error;}return result;
  }
  const status=(id,text)=>{if(el(id))el(id).textContent=text;};
  function waitIce(pc){return new Promise((resolve,reject)=>{
    if(pc.iceGatheringState==='complete')return resolve();
    const timeout=setTimeout(()=>{cleanup();reject(new Error('Could not prepare the media connection.'));},12000);
    function cleanup(){clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',change);}
    function change(){if(pc.iceGatheringState==='complete'){cleanup();resolve();}}
    pc.addEventListener('icegatheringstatechange',change);
  });}
  function waitConnected(pc){return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('The media connection timed out.'));},20000);
    function cleanup(){clearTimeout(timer);pc.removeEventListener('connectionstatechange',change);}
    function change(){if(pc.connectionState==='connected'){cleanup();resolve();}else if(['failed','closed'].includes(pc.connectionState)){cleanup();reject(new Error('The media connection failed.'));}}
    pc.addEventListener('connectionstatechange',change);change();
  });}
  async function peer(liveId,kind,media,video) {
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]});
    let connectionId=null;
    try{
      if(kind==='publish')media.getTracks().forEach(t=>pc.addTransceiver(t,{direction:'sendonly'}));
      else {const incoming=new MediaStream();video.srcObject=incoming;pc.ontrack=e=>{incoming.addTrack(e.track);video.play().catch(()=>{});};['video','audio'].forEach(t=>pc.addTransceiver(t,{direction:'recvonly'}));}
      await pc.setLocalDescription(await pc.createOffer());await waitIce(pc);
      let response;
      for(let attempt=0;attempt<5;attempt++){
        try{response=await api('signal',{liveId,kind,sdp:pc.localDescription.sdp});break;}
        catch(e){if(kind!=='play'||e.status!==502||attempt===4)throw e;await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));}
      }
      connectionId=response.connectionId;
      await pc.setRemoteDescription({type:'answer',sdp:response.sdp});await waitConnected(pc);
      return {pc,connectionId,liveId};
    }catch(e){pc.close();if(connectionId)api('disconnect',{liveId,connectionId}).catch(()=>{});throw e;}
  }
  async function disconnect(p){if(!p)return;p.pc.close();await api('disconnect',{liveId:p.liveId,connectionId:p.connectionId}).catch(()=>{});}

  // Each segment is a complete media file. It survives a reload in IndexedDB before any upload starts.
  const dbPromise=new Promise((resolve,reject)=>{
    const r=indexedDB.open('openvideo-live-recordings',1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('segments',{keyPath:'key'});r.result.createObjectStore('recordings',{keyPath:'id'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Local recording storage is unavailable.'));
  });
  dbPromise.catch(()=>{}); // Local storage is optional when replay recording is disabled.
  async function local(store,mode,operation){const db=await dbPromise;return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,mode);const request=operation(tx.objectStore(store));
    tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(new Error('Could not save the local recording.'));tx.onabort=tx.onerror;
  });}
  const saveRecording=r=>local('recordings','readwrite',s=>s.put(r));
  const mimeType=()=>['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
  async function uploadSegment(segment){
    const mime=segment.blob.type.split(';')[0];
    const result=await api('segment-upload',{liveId:segment.liveId,ordinal:segment.ordinal,bytes:segment.blob.size,mime,durationMs:segment.durationMs});
    if(!result.uploaded){
      const {error}=await sb.storage.from('live-replays').uploadToSignedUrl(result.path,result.token,segment.blob,{contentType:mime,upsert:false});
      // A previous upload can have succeeded before its acknowledgement was lost.
      if(error && !/already exists|duplicate|resource already/i.test(error.message))throw new Error('Replay upload paused. Use Recover recordings to retry.');
      await api('segment-complete',{liveId:segment.liveId,ordinal:segment.ordinal});
    }
    await local('segments','readwrite',s=>s.delete(segment.key));
  }
  function recordSegment(state){
    if(state.stopping)return;
    const recorder=new MediaRecorder(state.media,{mimeType:state.mime,videoBitsPerSecond:1800000,audioBitsPerSecond:96000});
    const parts=[],started=performance.now(),ordinal=state.count++;
    state.recorder=recorder;
    state.segmentDone=new Promise((resolve,reject)=>{
      recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
      recorder.onerror=()=>{state.recordingFailed=true;reject(new Error('The browser could not record this broadcast.'));};
      recorder.onstop=async()=>{
        clearTimeout(state.segmentTimer);
        const durationMs=Math.max(1,Math.round(performance.now()-started));
        const blob=new Blob(parts,{type:state.mime.split(';')[0]});
        const segment={key:`${state.id}:${ordinal}`,liveId:state.id,ordinal,durationMs,blob};
        try{
          if(!blob.size||blob.size>20971520||durationMs>120000)throw new Error('Recording was interrupted. Keep this tab visible while broadcasting.');
          await local('segments','readwrite',s=>s.put(segment));
          await saveRecording({id:state.id,ownerId:state.ownerId,count:state.count,title:state.title});
          state.queue=state.queue.then(()=>uploadSegment(segment)).catch(()=>{state.pending=true;status('liveBroadcastStatus','Live · recording saved on this device; upload pending');});
          if(!state.stopping)recordSegment(state);
          resolve();
        }catch(e){state.recordingFailed=true;state.stopping=true;reject(e);status('liveBroadcastStatus',errorMessage(e));stopBroadcast().catch(()=>{});}
      };
    });
    // Attach a rejection handler immediately; stopping still awaits the original promise.
    state.segmentDone.catch(()=>{});recorder.start();
    state.segmentTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},30000);
  }
  async function startBroadcast(){
    if(broadcast||loading)return;loading=true;el('liveStart').disabled=true;
    let media=null,liveId=null;
    try{
      const {data:{user}}=await sb.auth.getUser();if(!user)throw new Error('Sign in before starting a broadcast.');
      const recording=el('liveRecord').checked;
      if(recording&&(!window.MediaRecorder||!mimeType()))throw new Error('This browser cannot record a replay. Uncheck Save a private replay to broadcast without recording.');
      if(recording)await dbPromise;
      const title=el('liveTitle').value.trim();if(!title)throw new Error('Enter a broadcast title.');
      status('liveBroadcastStatus','Preparing camera and microphone…');
      media=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24}},audio:true});
      const channel=await ensureChannel();if(!channel)throw new Error('Create a channel before broadcasting.');
      const result=await api('create',{channelId:channel.id,title,access:el('liveAccess').value,category:el('liveCategory').value,country:el('liveCountry').value,city:el('liveCity').value,recordingEnabled:recording});liveId=result.id;
      el('livePreview').srcObject=media;
      status('liveBroadcastStatus','Connecting your broadcast…');
      const connection=await peer(liveId,'publish',media);
      const state={id:liveId,title,ownerId:user.id,media,connection,recording,mime:recording?mimeType():null,count:0,queue:Promise.resolve(),stopping:false,pending:false};
      broadcast=state;
      if(recording){await saveRecording({id:state.id,ownerId:user.id,count:0,title});recordSegment(state);}
      await api('heartbeat',{liveId,broadcast:true});
      state.heartbeat=setInterval(async()=>{try{await api('heartbeat',{liveId,broadcast:true});}catch(e){status('liveBroadcastStatus',errorMessage(e));stopBroadcast().catch(()=>{});}},15000);
      connection.pc.addEventListener('connectionstatechange',()=>{if(connection.pc.connectionState==='failed')stopBroadcast().catch(()=>{});});
      media.getTracks().forEach(t=>t.addEventListener('ended',()=>stopBroadcast().catch(()=>{})));
      el('liveStop').disabled=false;el('liveTitle').disabled=true;el('liveAccess').disabled=true;
      ['liveCategory','liveCountry','liveCity','liveRecord'].forEach(id=>el(id).disabled=true);
      el('liveOnAir').hidden=false;
      status('liveBroadcastStatus',recording?'You are live · private replay recording in parallel':'You are live · recording is off');discover();
    }catch(e){
      if(broadcast){await stopBroadcast().catch(()=>{});}else{media?.getTracks().forEach(t=>t.stop());if(liveId)await api('end',{liveId}).catch(()=>{});}
      status('liveBroadcastStatus',errorMessage(e));
    }finally{loading=false;el('liveStart').disabled=!!broadcast;}
  }
  async function stopBroadcast(){
    const state=broadcast;if(!state||state.finishing)return;state.finishing=true;state.stopping=true;
    clearInterval(state.heartbeat);clearTimeout(state.segmentTimer);el('liveStop').disabled=true;
    status('liveBroadcastStatus',state.recording?'Ending broadcast and saving private replay…':'Ending broadcast…');
    // Stop public discovery promptly, independently of local recording/upload completion.
    const ending=api('end',{liveId:state.id}).then(()=>true).catch(()=>false);
    try{
      if(state.recorder?.state==='recording')state.recorder.stop();
      await state.segmentDone;
    }catch{state.recordingFailed=true;}
    state.media.getTracks().forEach(t=>t.stop());await disconnect(state.connection);
    let ended=await ending;if(!ended){try{await api('end',{liveId:state.id});ended=true;}catch{}}
    await state.queue;
    try{
      if(!state.recording){if(!ended)throw new Error('Camera stopped. The broadcast will expire shortly; refresh to check its status.');status('liveBroadcastStatus','Broadcast ended · no replay was recorded');}
      else{
      const remaining=(await local('segments','readonly',s=>s.getAll())).filter(s=>s.liveId===state.id);
      if(!ended||remaining.length||state.recordingFailed)throw new Error('Recording saved on this device. Use Recover recordings to finish uploading.');
      await api('finalize',{liveId:state.id,count:state.count});
      await local('recordings','readwrite',s=>s.delete(state.id));
      status('liveBroadcastStatus','Broadcast ended · private replay is ready in My recordings. Review it before publishing.');
      }
    }catch(e){status('liveBroadcastStatus',errorMessage(e));}
    broadcast=null;el('livePreview').srcObject=null;el('liveOnAir').hidden=true;
    ['liveCategory','liveCountry','liveCity','liveRecord'].forEach(id=>el(id).disabled=false);
    el('liveStart').disabled=false;el('liveTitle').disabled=false;el('liveAccess').disabled=false;discover();
  }
  async function recover(){
    if(broadcast||loading)return;loading=true;el('liveRecover').disabled=true;
    try{
      const {data:{user}}=await sb.auth.getUser();if(!user)throw new Error('Sign in with the account that recorded the broadcast.');
      const recordings=(await local('recordings','readonly',s=>s.getAll())).filter(r=>r.ownerId===user.id);
      if(!recordings.length){status('liveBroadcastStatus','No pending recordings on this device.');return;}
      for(const rec of recordings){
        status('liveBroadcastStatus',`Recovering “${rec.title}”…`);
        await api('end',{liveId:rec.id});
        const segments=(await local('segments','readonly',s=>s.getAll())).filter(s=>s.liveId===rec.id).sort((a,b)=>a.ordinal-b.ordinal);
        for(const segment of segments)await uploadSegment(segment);
        if(!rec.count)continue;
        await api('finalize',{liveId:rec.id,count:rec.count});await local('recordings','readwrite',s=>s.delete(rec.id));
      }
      status('liveBroadcastStatus','Saved recordings recovered as private drafts. Review them in My recordings.');discover();
    }catch(e){status('liveBroadcastStatus',errorMessage(e));}finally{loading=false;el('liveRecover').disabled=false;}
  }
  async function discover(){
    try{
      const [{sessions},replays]=await Promise.all([api('list'),api('replays')]);
      el('liveGrid').innerHTML=sessions.map(s=>`<article class="video-card"><div class="thumb"><div class="thumb-art" style="--a:#15345e;--b:#413172"><div class="thumb-text">${s.state==='live'?'LIVE':s.state==='starting'?'STARTING':'REPLAY'}</div></div><span class="duration">${s.access==='subscribers'?'Subscribers':'Public'}</span></div><div class="video-meta"><div class="mini-avatar"></div><div><div class="video-title">${escape(s.title)}</div><div class="subtext">${escape(s.channel_name)} · ${s.viewers} watching · ${s.likes} likes</div><button class="ghost" data-live-id="${s.id}" data-live-title="${escape(s.title)}" data-live-replay="${s.state==='ended'}">${s.state==='ended'?'Watch replay':'Watch live'}</button></div></div></article>`).join('');
      status('liveDiscoveryStatus',sessions.length?'Active live broadcasts':'No active broadcasts. Start one from your channel.');
      el('liveGrid').querySelectorAll('[data-live-id]').forEach(btn=>btn.onclick=()=>open(btn.dataset.liveId,btn.dataset.liveReplay==='true',btn.dataset.liveTitle));
      renderRecordings('liveReplayGrid',replays.sessions,false);
      await library();
    }catch(e){status('liveDiscoveryStatus',errorMessage(e));}
  }
  function renderRecordings(target,sessions,owner){
    el(target).innerHTML=sessions.map(s=>`<article class="studio-card"><h3>${escape(s.title)}</h3><p class="subtext">${escape(s.channel_name)} · ${escape(s.category||'Community')} ${escape([s.city,s.country].filter(Boolean).join(', '))}</p><p class="subtext">${s.access==='subscribers'?'Channel subscribers':'Public audience'} · ${s.replay_published_at?'Published':s.replay_state==='ready'?'Private draft':escape(s.replay_state)}</p>${s.replay_state==='ready'?`<div class="live-actions"><button class="ghost" data-review="${s.id}">Watch replay</button>${owner?`<button class="primary" data-publish="${s.id}" data-published="${!!s.replay_published_at}">${s.replay_published_at?'Unpublish replay':'Publish replay'}</button>`:''}</div>`:''}</article>`).join('');
    el(target).querySelectorAll('[data-review]').forEach(btn=>btn.onclick=()=>open(btn.dataset.review,true,sessions.find(s=>s.id===btn.dataset.review).title));
    el(target).querySelectorAll('[data-publish]').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;try{await api('publish-replay',{liveId:btn.dataset.publish,published:btn.dataset.published!=='true'});await discover();}catch(e){toast(errorMessage(e));btn.disabled=false;}});
  }
  async function library(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session){el('liveLibrary').innerHTML='';status('liveLibraryStatus','Sign in to see your recordings.');return;}
    try{const {sessions}=await api('library');renderRecordings('liveLibrary',sessions.filter(s=>s.state==='ended'),true);status('liveLibraryStatus','Only you can see unpublished recordings. Publishing keeps the original audience setting.');}
    catch(e){status('liveLibraryStatus',errorMessage(e));}
  }
  async function stopWatching(){
    watchGeneration++;const old=watching;watching=null;
    if(old){clearInterval(old.poll);clearInterval(old.heartbeat);await disconnect(old.connection);}
    const player=el('livePlayer');player.pause();player.srcObject=null;player.removeAttribute('src');player.onended=null;player.load();
  }
  async function refreshState(state){
    const data=await api('state',{liveId:state.id});if(watching!==state)return;
    liked=data.liked;status('liveAudience',`${data.viewers} watching · ${data.likes} likes`);
    el('liveLike').textContent=`${liked?'♥':'♡'} Like`;
    el('liveChat').innerHTML=data.messages.map(m=>`<div class="comment"><strong>${escape(m.display_name)}</strong><p>${escape(m.body)}</p></div>`).join('')||'<p class="subtext">No messages yet.</p>';
    if(data.state==='ended'&&!state.replay){status('liveWatchStatus',data.replay_available?'Broadcast ended. Replay is ready.':'Broadcast ended. No published replay is available.');
      el('liveReplayButton').hidden=!data.replay_available;
      clearInterval(state.heartbeat);
    }
    if(state.replay&&!data.replay_available){await stopWatching();throw new Error('This replay is no longer published.');}
    el('liveSend').disabled=data.state==='ended'||state.replay;
  }
  async function open(liveId,replay=false,title='OpenVideo Live'){
    await stopWatching();const generation=watchGeneration;
    go('live-watch');location.hash=`live-${replay?'replay-':''}${liveId}`;
    status('liveWatchTitle',title);status('liveWatchStatus',replay?'Loading replay…':'Connecting to broadcast…');
    el('liveReplayButton').hidden=true;el('liveSegments').hidden=true;
    const state={id:liveId,replay,title};watching=state;
    try{
      await refreshState(state);
      if(replay){
        const result=await api('replay',{liveId});if(generation!==watchGeneration)return;
        state.segments=result.segments;state.ordinal=0;
        el('liveSegments').innerHTML=result.segments.map(s=>`<option value="${s.ordinal}">Part ${s.ordinal+1}</option>`).join('');el('liveSegments').hidden=false;
        el('livePlayer').onended=()=>{if(watching===state&&state.ordinal+1<state.segments.length)playSegment(state,++state.ordinal).catch(e=>status('liveWatchStatus',errorMessage(e)));};
        await playSegment(state,0);
      }else{
        const connection=await peer(liveId,'play',null,el('livePlayer'));
        if(generation!==watchGeneration){await disconnect(connection);return;}state.connection=connection;
        await api('heartbeat',{liveId});
        state.heartbeat=setInterval(()=>api('heartbeat',{liveId}).catch(e=>{if(e.status===403||e.status===401){stopWatching();status('liveWatchStatus',errorMessage(e));}}),15000);
        status('liveWatchStatus','Live · enable sound using the player controls');
      }
      if(generation!==watchGeneration)return;
      state.poll=setInterval(()=>refreshState(state).catch(e=>{if(e.status===403||e.status===401){stopWatching();}status('liveWatchStatus',errorMessage(e));}),4000);
    }catch(e){if(generation===watchGeneration){await stopWatching();status('liveWatchStatus',errorMessage(e));}}
  }
  async function playSegment(state,ordinal){
    const result=await api('replay-segment',{liveId:state.id,ordinal});if(watching!==state)return;
    state.ordinal=ordinal;el('liveSegments').value=String(ordinal);
    el('livePlayer').src=result.url;await el('livePlayer').play().catch(()=>{});
    status('liveWatchStatus',`Replay · part ${ordinal+1} of ${state.segments.length}`);
  }
  el('liveStart').onclick=startBroadcast;el('liveStop').onclick=stopBroadcast;el('liveRecover').onclick=recover;
  el('liveRefresh').onclick=discover;
  el('liveLike').onclick=async()=>{if(!watching)return;try{await api('like',{liveId:watching.id,liked:!liked});await refreshState(watching);}catch(e){toast(errorMessage(e));}};
  el('liveChatForm').onsubmit=async e=>{e.preventDefault();if(!watching)return;el('liveSend').disabled=true;try{await api('chat',{liveId:watching.id,body:el('liveMessage').value});el('liveMessage').value='';await refreshState(watching);}catch(e){toast(errorMessage(e));}finally{el('liveSend').disabled=!watching||watching.replay;}};
  el('liveReplayButton').onclick=()=>watching&&open(watching.id,true,watching.title);
  el('liveSegments').onchange=()=>watching&&playSegment(watching,Number(el('liveSegments').value)).catch(e=>status('liveWatchStatus',errorMessage(e)));
  document.addEventListener('openvideo:view',e=>{
    if(e.detail!=='live-watch'&&watching)stopWatching();
    clearInterval(discoverTimer);if(e.detail==='live'){discover();discoverTimer=setInterval(discover,15000);}
  });
  window.addEventListener('beforeunload',e=>{if(broadcast){e.preventDefault();e.returnValue='';}});
  sb.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){stopWatching();if(broadcast)stopBroadcast();}});
  const route=location.hash.slice(1),match=route.match(/^live-(replay-)?([0-9a-f-]{36})$/i);
  if(match)open(match[2],!!match[1]);else if(route==='live'){go('live');discover();}
  window.OpenVideoLive={open,discover};
})();
