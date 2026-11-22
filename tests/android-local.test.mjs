import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { createSchedule } from '../web/src/local-schedule.ts';
import { planLocal } from '../web/src/local-planner.ts';
import { foregroundClock } from '../web/src/foreground.ts';
import { migrateFavourites } from '../web/src/migrate.ts';
import { indexedDB } from 'fake-indexeddb';

// Deterministic test inputs only. Never packaged with the application.
const files = {
  'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nr,A,Origine - Terminus,0',
  'stops.txt': 'stop_id,stop_code,stop_name,stop_lat,stop_lon\nABC_01,C1,Origine,48.58,7.75\nEND_01,E1,Terminus,48.59,7.76',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nw,1,1,1,1,1,1,1,20260101,20261231',
  'calendar_dates.txt': 'service_id,date,exception_type\nw,20261117,2\nadded,20261117,1',
  'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id\nr,w,night,Terminus,0\nr,added,extra,Terminus,0\nr,w,no,Terminus,0',
  'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type\nnight,24:10:00,24:10:00,ABC_01,1,0\nnight,24:25:00,24:25:00,END_01,2,0\nextra,12:50:00,12:50:00,ABC_01,1,0\nextra,13:00:00,13:00:00,END_01,2,0\nno,12:00:00,12:00:00,ABC_01,1,1\nno,12:20:00,12:20:00,END_01,2,0'
};
const archive = zipSync(Object.fromEntries(Object.entries(files).map(([k,v]) => [k,strToU8(v)])));
const time = s => Date.parse(s);
test('local calendars, exceptions, previous service day, aliases and boarding rules', async () => {
  const f = createSchedule(); await f.load(archive);
  assert.equal(f.scheduledVisits(['C1'],time('2026-11-17T00:00:00+01:00'),10)[0].time,time('2026-11-17T00:10:00+01:00'));
  const visits = f.scheduledVisits(['ABC'],time('2026-11-17T11:00:00+01:00'),10);
  assert.equal(visits.length,1); assert.equal(visits[0].time,time('2026-11-17T12:50:00+01:00'));
  assert.equal(f.scheduledVisits(['END_01'],time('2026-11-17T11:00:00+01:00'),10).length,0);
  assert.equal(f.validUntil(),'20261231');
  assert.equal(f.scheduledVisits(['ABC'],time('2027-01-03T12:00:00+01:00'),10).length,0);
  await assert.rejects(f.load(new Uint8Array([1,2,3])));
  assert.equal(f.scheduledStops().StopPointsDelivery.AnnotatedStopPointRef.length,2);
  assert.ok(f.scheduledDepartures('ABC',time('2026-11-17T11:00:00+01:00')).ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit.every(v => !('ExpectedDepartureTime' in v.MonitoredVehicleJourney.MonitoredCall)));
});
test('GTFS noon minus twelve hours on both DST transitions', async () => {
  const f = createSchedule(); await f.load(archive);
  // 24:10 on the service day ending after the clock change.
  for (const [at,expected] of [['2026-03-29T23:00:00+02:00','2026-03-30T00:10:00+02:00'],['2026-10-25T23:00:00+01:00','2026-10-26T00:10:00+01:00']]) {
    assert.equal(f.scheduledVisits(['ABC'],time(at),1)[0].time,time(expected));
  }
});
test('30 second foreground clock suspends and resumes without overlapping timers', () => {
  let ticks=0, starts=0, clears=0, callback;
  const active = foregroundClock(() => ticks++, { set: fn => { starts++; callback=fn; return 1; }, clear: () => clears++ });
  active(true); active(true); callback(); assert.equal(ticks,2); assert.equal(starts,1);
  active(false); active(false); assert.equal(clears,1);
  active(true); assert.equal(ticks,3); assert.equal(starts,2);
});
test('favourites migrate by codes and name, preserving unknown entries and preferences', () => {
  const old=[{id:'legacy',name:'Homme de Fer',refs:['C1'],lat:48.58,lon:7.75}];
  const current=[{id:'ABC',name:'Homme de Fer',refs:['C1'],lat:48.58,lon:7.75}];
  assert.deepEqual(migrateFavourites(['legacy','missing'],old,current),['ABC','missing']);
});
test('offline journeys include a feasible transfer and arrival-before search', () => {
  const at=time('2026-11-17T10:00:00Z');
  const positions=new Map([['a',{lat:48,lon:7}],['b',{lat:48.02,lon:7}],['c',{lat:48.04,lon:7}]]);
  const courses=[{id:'1',line:'A',dest:'B',mode:'tram',calls:[{code:'a',name:'A',dep:at+60000,arr:at+60000},{code:'b',name:'B',dep:at+600000,arr:at+600000}]},{id:'2',line:'B',dest:'C',mode:'bus',calls:[{code:'b',name:'B',dep:at+780000,arr:at+780000},{code:'c',name:'C',dep:at+1200000,arr:at+1200000}]}];
  const plan=planLocal(courses,positions,positions.get('a'),positions.get('c'),at);
  assert.ok(plan.itineraries.length); assert.equal(plan.itineraries[0].transfers,1);
  assert.ok(plan.itineraries[0].legs.every(l=>l.realTime===false));
  const reverse=planLocal(courses,positions,positions.get('a'),positions.get('c'),at+1500000,true);
  assert.ok(reverse.itineraries.length); assert.ok(time(reverse.itineraries[0].endTime)<=at+1500000);
  const impossible=structuredClone(courses); impossible[1].calls[0].dep=at+610000;
  assert.equal(planLocal(impossible,positions,positions.get('a'),positions.get('c'),at).itineraries.length,0);
});
test('worker persists the last valid archive and rejects corrupt synchronization atomically', async () => {
  globalThis.indexedDB=indexedDB;
  const pending = new Map();
  globalThis.self={postMessage: v => { pending.get(v.id)(v); pending.delete(v.id); }};
  await import('../web/src/local-worker.ts');
  let id=0;
  const request=data=>new Promise(r=>{const seq=++id; pending.set(seq,r); self.onmessage({data:{id:seq,...data}});});
  const save=await request({method:'save',source:'cts',value:{bytes:archive,checked:100,revision:'first'}});
  assert.equal(save.result,true);
  const bad=await request({method:'save',source:'cts',value:{bytes:new Uint8Array([1]),checked:200,revision:'bad'}});
  assert.ok(bad.error);
  const status=await request({method:'status'}); assert.equal(status.result.cts.revision,'first');
  const departures=await request({method:'query',path:'/api/gtfs/departures?MonitoringRef=ABC&at='+time('2026-11-17T11:00:00+01:00')});
  assert.ok(departures.result.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit.length);
  const db=await new Promise((r,j)=>{const req=indexedDB.open('kumm-gtfs',1);req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error);});
  const stored=await new Promise(r=>{const req=db.transaction('feeds').objectStore('feeds').get('cts');req.onsuccess=()=>r(req.result);});
  assert.equal(stored.revision,'first'); assert.deepEqual(stored.bytes,archive); db.close();
  const realFetch = globalThis.fetch;
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  try {
    const loading = request({ method:'save', source:'cts', archiveUrl:'https://localhost/archive.zip', value:{checked:300,revision:'next'} });
    const during = await request({method:'status'});
    assert.equal(during.result.cts.revision,'first');
    release(new Response(archive));
    assert.equal((await loading).result,true);
    assert.equal((await request({method:'status'})).result.cts.revision,'next');
  } finally { globalThis.fetch = realFetch; }
});
test('local vehicle engine: positions follow the official timetable, with layover chains and no invented trips', async () => {
  const { vehiclesAt, buildChains, tripCode } = await import('../web/src/local-vehicles.ts');
  const f = createSchedule(); await f.load(archive);
  const day = time('2026-11-17T12:00:00+01:00');
  const stopPos = new Map([['ABC_01', { lat: 48.58, lon: 7.75 }], ['END_01', { lat: 48.59, lon: 7.76 }]]);
  const t = (hm) => time(`2026-11-17T${hm}:00+01:00`);
  const out = { id: 'out', line: 'A', dest: 'Terminus', mode: 'tram', aimed: t('12:00'), calls: [
    { code: 'ABC_01', name: 'Origine', arr: t('12:00'), dep: t('12:00') }, { code: 'END_01', name: 'Terminus', arr: t('12:10'), dep: t('12:10') }] };
  const back = { id: 'back', line: 'A', dest: 'Origine', mode: 'tram', aimed: t('12:20'), calls: [
    { code: 'END_01', name: 'Terminus', arr: t('12:20'), dep: t('12:20') }, { code: 'ABC_01', name: 'Origine', arr: t('12:30'), dep: t('12:30') }] };
  const chains = buildChains([out, back]);
  assert.equal(chains.get('back').id, 'out', 'the vehicle arriving at the terminus makes the return trip');
  const at = (hm) => vehiclesAt(t(hm), [out, back], stopPos, chains);
  assert.equal(at('11:55').length, 0, 'nothing runs before the first departure');
  const mid = at('12:05');
  assert.equal(mid.length, 1); assert.equal(mid[0].id, 'out');
  assert.ok(mid[0].a[2] < t('12:05') && t('12:05') < mid[0].b[2], 'moving between two scheduled stops');
  assert.deepEqual(mid[0].next[0], ['Terminus', t('12:10')]);
  const wait = at('12:15');
  assert.equal(wait.length, 1); assert.equal(wait[0].id, 'back'); assert.equal(wait[0].w, true, 'waits at the terminus until its scheduled departure');
  assert.equal(at('12:31').length, 0, 'finished trips disappear');
  assert.match(tripCode(out), /^ori\w*a\d{6}1200$/);
  assert.equal(f.scheduledCourses(day).courses.every(c => c.realTime === false), true);
});
