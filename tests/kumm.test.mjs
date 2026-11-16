import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const listen = async fn => {
  const server = http.createServer(fn);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server;
};
const base = server => "http://127.0.0.1:" + server.address().port;

function fixtureZip(files) {
  const parts = [], directory = [];
  let offset = 0;
  for (const [file, text] of Object.entries(files)) {
    const name = Buffer.from(file + ".txt"), data = Buffer.from(text.trim() + "\n");
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}
const fixture = fixtureZip({
  routes: `route_id,route_short_name,route_long_name,route_type,route_color,route_text_color
r,A,Origine - Terminus,0,E10D19,FFFFFF`,
  stops: `stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station
ABC_01,C1,Origine,48.58,7.75,0,
ABC_02,C2,Origine,48.5801,7.7501,0,
END_01,E1,Terminus,48.59,7.76,0,`,
  trips: `route_id,service_id,trip_id,trip_headsign,direction_id
r,w,night,Terminus,0
r,w,board,Terminus,0
r,w,noboard,Terminus,0
r,added,extra,Terminus,0`,
  calendar: `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
w,1,1,1,1,1,0,0,20261101,20261130`,
  calendar_dates: `service_id,date,exception_type
w,20261117,2
added,20261117,1`,
  stop_times: `trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type
night,24:09:00,24:10:00,ABC_01,1,0
board,12:10:00,12:10:00,ABC_02,1,0
night,24:25:00,24:25:00,END_01,2,0
board,12:25:00,12:25:00,END_01,2,0
noboard,11:00:00,11:00:00,ABC_01,1,1
noboard,11:25:00,11:25:00,END_01,2,0
extra,12:50:00,12:50:00,ABC_01,1,0
extra,13:00:00,13:00:00,END_01,2,0`
});

async function start(t, login = "") {
  const state = await mkdtemp(path.join(os.tmpdir(), "kumm-tests-"));
  let siri = 0;
  const feed = process.env.CTS_TEST_GTFS ? await readFile(process.env.CTS_TEST_GTFS) : fixture;
  const upstream = await listen((req, res) => {
    if (req.url.startsWith("/siri/")) siri++;
    if (req.url === "/cts.zip") return res.end(feed);
    res.writeHead(404).end();
  });
  const tmp = await listen();
  const port = tmp.address().port, origin = base(tmp);
  await new Promise(resolve => tmp.close(resolve));
  const other = base(upstream) + "/unavailable";
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, PORT: String(port), STATE_DIR: state, WEB_LOGIN: login,
    CTS_MODE: "scheduled", CTS_TRAFFIC: "1", CTS_TOKEN: "fixture-used-only-if-regression",
    CTS_BASE: base(upstream) + "/siri", CTS_ROOT: base(upstream) + "/siri",
    CTS_GTFS_URL: base(upstream) + "/cts.zip", TER_GTFS_URL: other, TER_RT_URL: other,
    VELHOP_INFO: other, VELHOP_STATUS: other, OCCUPATION_URL: other,
    ENABLE_DIAG: "1"
  } });
  let logs = "";
  child.stderr.on("data", data => { logs += data; });
  child.stdout.resume();
  t.after(async () => {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", resolve); });
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    await rm(state, { recursive: true, force: true });
  });
  for (let i = 0; i < 240; i++) {
    const ready = await fetch(origin + "/health").then(r => r.json(), () => null);
    if (ready?.horaires_cts?.courses) return { origin, siriCalls: () => siri };
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail("Serveur GTFS non prêt. " + logs);
}

test("GTFS public, calendrier, quais, horaires et blocage SIRI", async t => {
  const { origin, siriCalls } = await start(t);
  const get = route => fetch(origin + route);
  const mode = await (await get("/api/kumm-mode")).json();
  assert.equal(mode.cts, "scheduled");
  assert.equal(mode.traffic, false);
  const stops = await (await get("/api/gtfs/stops")).json();
  const lines = await (await get("/api/gtfs/lines")).json();
  assert.equal(stops.source, "gtfs");
  assert.ok(lines.lines.some(x => x.PublishedLineName === "A" && x.RouteType === 0));
  if (process.env.CTS_TEST_GTFS) {
    assert.ok(stops.StopPointsDelivery.AnnotatedStopPointRef.some(s => s.StopPointRef === "HOFER_13" && s.StopName === "Homme de Fer"));
    const r = await (await get("/geo/stoptimes?stop=HOFER&time=2026-11-16T08%3A00%3A00Z")).json();
    assert.ok(r.stopTimes.length > 0);
    assert.ok(r.stopTimes.every(t => !t.cancelled && t.place.scheduledDeparture));
  } else {
    const request = time => get("/geo/stoptimes?stop=ABC&time=" + encodeURIComponent(time)).then(r => r.json());
    const monday = await request("2026-11-16T08:00:00Z");
    assert.equal(monday.stopTimes[0].place.scheduledDeparture, "2026-11-16T11:10:00.000Z");
    assert.ok(monday.stopTimes.some(d => d.place.scheduledDeparture === "2026-11-16T23:10:00.000Z"));
    assert.ok(!monday.stopTimes.some(d => d.place.scheduledDeparture === "2026-11-16T10:00:00.000Z"));
    const tuesday = await request("2026-11-17T08:00:00Z");
    assert.deepEqual(tuesday.stopTimes.map(d => d.place.scheduledDeparture), ["2026-11-17T11:50:00.000Z"]);
  }
  assert.equal((await get("/api/stop-monitoring?MonitoringRef=ABC")).status, 503);
  assert.equal((await get("/api/general-message")).status, 503);
  assert.equal((await get("/diag")).status, 404);
  assert.equal((await (await get("/api/messages")).json()).message, "Prochainement disponible");
  assert.equal((await get("/api/ter-stations")).status, 200);
  assert.equal(siriCalls(), 0);
});

test("Une clé embarquée et des en-têtes forgés ne remplacent jamais une session privée", async t => {
  const { origin } = await start(t, "test:mot-de-passe-fixture");
  for (const route of ["/api/gtfs/stops", "/api/vehicles", "/geo/weather", "/poi/velhop", "/tiles/1/1/1.png"]) {
    const response = await fetch(origin + route, { redirect: "manual", headers: {
      "X-App-Key": "ancienne-cle-de-test", Origin: "https://localhost", Referer: "https://localhost/"
    } });
    assert.equal(response.status, 401, route);
  }
  const login = await fetch(origin + "/connexion", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ user: "test", password: "mot-de-passe-fixture" }) });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const result = await fetch(origin + "/api/gtfs/stops", { headers: { Cookie: cookie } });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});
