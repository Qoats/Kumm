// Browser integration with the native transport bridge replaced by recorded official GTFS archives.
// This verifies the UI + worker + IndexedDB, not Android's native HTTP/SQLite/installer.
// Usage: node scripts/check-android-local.mjs /path/cts.zip /path/sncf.zip [http://127.0.0.1:5173]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const [cts,ter,base='http://127.0.0.1:5173'] = process.argv.slice(2);
if (!cts || !ter) throw Error('Deux archives GTFS officielles sont requises');
const bytes={cts:fs.readFileSync(cts).toString('base64'),ter:fs.readFileSync(ter).toString('base64')};
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 let offline=false, syncs=0, installs=0, installAllowed=true, installSettings=0;
 const updates=process.env.TEST_UPDATES==='1';
 await context.exposeFunction('__native',async (plugin,method,options)=>{
   if(plugin==='KummGtfs') {
     if(method==='sync') { syncs++; if(offline) throw Error('Offline'); return Object.fromEntries(['cts','ter'].map(s=>[s,{revision:s+'-official',checked:Date.now()}])); }
     if(method==='read') return {data:bytes[options.source]};
   }
   if(plugin==='App') return {version:'0.53.0',build:'10000'};
   if(plugin==='KummUpdater') {
     if(method==='source') return {play:false};
     if(method==='canInstall') return {allowed:installAllowed};
     if(method==='openInstallSettings') {installSettings++; return {};}
     if(method==='install') { installs++; assert.match(options.url,/^https:\/\/github\.com\/Qoats\/Kumm\/releases\/download\//); return {}; }
   }
   if(plugin==='CapacitorHttp' && options.url==='https://api.github.com/repos/Qoats/Kumm/releases/latest') return {status:200,data:{draft:false,prerelease:false,assets:['latest.json','kumm.apk'].map(name=>({name,browser_download_url:'https://github.com/Qoats/Kumm/releases/download/test-only/'+name}))}};
   if(plugin==='CapacitorHttp' && options.url==='https://github.com/Qoats/Kumm/releases/download/test-only/latest.json') return {status:200,data:{version:'99.0.0',code:99999999,size:10,sha256:'a'.repeat(64)}};
   throw Error('Online service unavailable in offline test');
 });
 await context.addInitScript(()=>{
   window.androidBridge={}; window.__listeners={};
   window.__queries=0;
   const NativeWorker=window.Worker;
   window.Worker=class extends NativeWorker {
     postMessage(data,...args) { if(data.method==='query') window.__queries++; return super.postMessage(data,...args); }
   };
   window.Capacitor={PluginHeaders:[
      {name:'KummGtfs',methods:['sync','read'].map(name=>({name,rtype:'promise'}))},
      {name:'App',methods:[{name:'getInfo',rtype:'promise'},{name:'addListener'},{name:'removeListener'}]},
      {name:'CapacitorHttp',methods:[{name:'get',rtype:'promise'}]},
      {name:'KummUpdater',methods:[...['source','canInstall','install','openInstallSettings'].map(name=>({name,rtype:'promise'})),{name:'addListener'},{name:'removeListener'}]}
    ], nativePromise:(p,m,o)=>window.__native(p,m,o), nativeCallback:(p,m,o,fn)=>{(window.__listeners[o.eventName]??=[]).push(fn); return Promise.resolve('listener');}};
   localStorage.setItem('onboarding',JSON.stringify({done:true,terms:'2026-10-23'}));
 });
 const page=await context.newPage(), errors=[], forbidden=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin===base && /^\/(api|geo|poi|tiles|health|app)(\/|$)/.test(u.pathname)) {forbidden.push(u.pathname); return route.abort();}
   return route.continue();
 });
 await page.goto(base);
 await page.waitForFunction(()=>window.__kumm?.STOPS.length>1500,null,{timeout:60000});
 const stop=await page.evaluate(()=>window.__kumm.STOPS.find(s=>/Homme de Fer/i.test(s.name)));
 assert.ok(stop);
 if(updates) {
   await page.locator('[data-upd="later"]').waitFor({timeout:30000});
   assert.equal(installs,0,'automatic check must not download an APK');
   await page.locator('[data-upd="later"]').click();
 }
 await page.evaluate(()=>{window.__kumm.S.onb={steps:['features'],i:0,refused:false};window.__kumm.render();});
 assert.match(await page.locator('body').innerText(),/Horaires théoriques/i);
 assert.match(await page.locator('body').innerText(),/Bientôt disponible/);
 await page.evaluate(()=>{window.__kumm.S.onb=null;window.__kumm.render();});
 await page.evaluate(id=>{const k=window.__kumm;k.S.overlay={k:'stop',id};k.render();},stop.id);
 await page.waitForFunction(()=>document.getElementById('stopdeps')?.textContent?.includes('min'),null,{timeout:30000});
 assert.match(await page.locator('body').innerText(),/Horaires théoriques/i);
 await page.evaluate(()=>{window.__overlayBefore=document.querySelector('.overlay');});
 const before=await page.evaluate(()=>window.__queries), nativeBefore=syncs;
 await page.clock.install(); await page.clock.fastForward(31000);
 await page.waitForFunction(n=>window.__queries>n,before);
 assert.equal(syncs,nativeBefore,'30s clock must not download GTFS');
 assert.ok(await page.evaluate(()=>window.__overlayBefore===document.querySelector('.overlay')),'30s refresh must preserve the existing screen');
 await page.evaluate(()=>{for(const fn of window.__listeners.appStateChange??[])fn({isActive:false});});
 const paused=await page.evaluate(()=>window.__queries);
 await page.clock.fastForward(65000);
 assert.equal(await page.evaluate(()=>window.__queries),paused,'background clock must be suspended');
 await page.evaluate(()=>{for(const fn of window.__listeners.appStateChange??[])fn({isActive:true});});
 await page.waitForFunction(n=>window.__queries>n,paused);
 await page.evaluate(()=>{window.__kumm.S.overlay={k:'settings'};window.__kumm.render();});
 const manualBefore=syncs;
 await page.locator('[data-act="syncGtfs"]').click();
 await page.waitForFunction(()=>!document.body.textContent.includes('Vérification des données officielles…'),null,{timeout:30000});
 assert.ok(syncs>manualBefore);
 if(updates) {
   await page.locator('[data-act="checkUpdate"]').click();
   await page.locator('[data-upd="ignore"]').click();
   assert.equal(await page.evaluate(()=>localStorage.getItem('ignored-release')),'99999999');
   assert.equal(installs,0);
   await page.locator('[data-act="checkUpdate"]').click();
   installAllowed=false;
   await page.locator('[data-upd="go"]').click();
   await page.waitForFunction(()=>document.querySelector('.upd-msg')?.textContent?.includes('autoriser'));
   assert.equal(installs,0); assert.equal(installSettings,1);
   await page.evaluate(()=>{for(const fn of window.__listeners.resume??[])fn({});});
   await page.locator('[data-upd="go"]').waitFor();
   assert.equal(installs,0); assert.equal(installSettings,1,'denying install permission must not reopen settings');
   installAllowed=true;
   await page.locator('[data-upd="go"]').click();
   await page.locator('[data-upd="later"]').waitFor();
   assert.equal(installs,1,'download must follow explicit consent');
   await page.locator('[data-upd="later"]').click();
 }
 await page.evaluate(id=>{localStorage.setItem('fav',JSON.stringify([id]));},stop.id);
 await page.evaluate(()=>{const k=window.__kumm;k.S.tab='search';k.S.overlay=null;k.S.q='Homme';k.render();});
 assert.match(await page.locator('body').innerText(),/Homme de Fer/);
 await page.evaluate(()=>{window.__kumm.S.overlay={k:'line',id:'A'};window.__kumm.render();});
 await page.waitForFunction(()=>document.querySelector('.rail') && document.querySelectorAll('[data-stop]').length>5);
 const journeys=await page.evaluate(async()=>{
   const {fetchTransit}=await import('/src/transit.ts');
   return fetchTransit({lat:48.5851,lon:7.7338},{lat:48.5979,lon:7.7765});
 });
 assert.ok(journeys.length>0); assert.ok(journeys.every(j=>j.legs.every(l=>!l.realTime)));
 offline=true;
 await page.reload();
 await page.waitForFunction(()=>window.__kumm?.STOPS.length>1500,null,{timeout:30000});
 assert.deepEqual(await page.evaluate(()=>window.__kumm.S.fav),[stop.id]);
 await page.evaluate(id=>{window.__kumm.S.overlay={k:'stop',id};window.__kumm.render();},stop.id);
 await page.waitForFunction(()=>document.getElementById('stopdeps')?.textContent?.includes('min'));
 for(const overlay of ['msgs','stats','settings']) {
   await page.evaluate(k=>{window.__kumm.S.overlay={k};window.__kumm.render();},overlay);
   assert.match(await page.locator('body').innerText(),/Bientôt disponible/);
 }
 await page.screenshot({path:'/tmp/kumm-android-local-settings.png',fullPage:true});
 await page.evaluate(()=>{window.__kumm.S.overlay=null;window.__kumm.S.tab='nearby';window.__kumm.render();});
 // fond de carte livré avec l'appli : dessiné par MapLibre à partir du paquet local, sans aucune tuile en ligne
 await page.waitForFunction(()=>window.__kummMap && document.querySelector('.leaflet-gl-layer canvas'));
 assert.match(await page.locator('body').innerText(),/OpenStreetMap/);
 assert.equal(await page.locator('.leaflet-tile').count(),0,'no online raster tile when the offline map is available');
 await page.screenshot({path:'/tmp/kumm-android-local-map.png',fullPage:true});
 assert.deepEqual(forbidden,[],'Android must never request a Kumm server endpoint');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'passed',stops:await page.evaluate(()=>window.__kumm.STOPS.length),checks:['official-archives','onboarding-labels','offline-reload','favourites','search','lines','local-journeys','30s-local-refresh','background-pause','manual-sync','realtime-labels','map-source-and-attribution','no-kumm-server-requests'],updates: updates ? 'defer, ignore, manual check, consent before APK' : 'not requested',nativeBridge:'test adapter; Android runtime not emulated'}));
} finally {await browser.close();}
