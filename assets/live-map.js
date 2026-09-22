/* Country/city discovery uses only opt-in Live metadata. No coordinates or device geolocation. */
(()=>{
 const el=id=>document.getElementById(id),esc=x=>escapeHtml(String(x??''));let country='',city='',sessions=[],timer;
 const view=document.createElement('section');view.id='view-live-map';view.className='view';view.innerHTML='<div class="section-title"><h2>Live Map</h2><button class="ghost" id="mapRefresh">Refresh</button></div><p class="notice">Explore World → Country → City. Places are shared voluntarily by creators and are not independently verified. No precise device location is collected.</p><div id="mapBreadcrumb" class="live-actions"></div><p id="mapStatus" role="status"></p><div id="mapPlaces" class="live-actions"></div><div id="mapLives" class="grid"></div>';document.querySelector('.main').append(view);
 const nav=document.createElement('button');nav.textContent='Live Map';nav.dataset.nav='live-map';nav.onclick=()=>go('live-map');document.querySelector('.nav').append(nav);
 const shortcut=document.createElement('button');shortcut.className='ghost';shortcut.textContent='Live Map';shortcut.onclick=()=>go('live-map');el('liveRefresh').after(shortcut);
 function render(){
  el('mapBreadcrumb').innerHTML=`<button class="ghost" id="mapWorld">World</button>${country?`<button class="ghost" id="mapCountry">${esc(country)}</button>`:''}${city?`<span>${esc(city)}</span>`:''}`;
  el('mapWorld').onclick=()=>{country='';city='';render();};if(el('mapCountry'))el('mapCountry').onclick=()=>{city='';render();};
  const visible=sessions.filter(s=>(!country||s.country===country)&&(!city||s.city===city));
  const field=country?'city':'country',places=[...new Set(visible.map(s=>s[field]).filter(Boolean))].sort();
  el('mapPlaces').innerHTML=city?'':places.map((place,i)=>`<button class="ghost" data-place="${i}">${esc(place)} (${visible.filter(s=>s[field]===place).length})</button>`).join('');
  el('mapPlaces').querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>{if(country)city=places[Number(b.dataset.place)];else country=places[Number(b.dataset.place)];render();});
  el('mapStatus').textContent=visible.length?`${visible.length} active Live${visible.length===1?'':'s'}`:'No active Lives here right now.';
  el('mapLives').innerHTML=visible.map(s=>`<article class="studio-card"><h3>${esc(s.title)}</h3><p>${esc(s.channel_name||'Creator')} · ${esc(s.category||'General')}</p><p class="subtext">${esc([s.country,s.city].filter(Boolean).join(' / ')||'Location not shared')} · ${esc(s.access==='subscribers'?'Members only':'Public')}</p><button class="primary" data-map-live="${s.id}">Watch Live</button></article>`).join('');
  el('mapLives').querySelectorAll('[data-map-live]').forEach(b=>b.onclick=()=>OpenVideoLive.open(b.dataset.mapLive));
 }
 async function load(){try{sessions=(await OpenVideoLive.list()).sessions;render();}catch(e){el('mapStatus').textContent=e.message;el('mapLives').innerHTML='';}}
 el('mapRefresh').onclick=load;document.addEventListener('openvideo:view',e=>{clearInterval(timer);if(e.detail==='live-map'){load();timer=setInterval(load,15000);}});if(location.hash==='#live-map')go('live-map');
})();
