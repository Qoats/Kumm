package fr.kumm.app;

import static org.junit.Assert.*;
import android.content.Context;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.zip.*;
import org.json.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class LocalTimetableTest {
    private File archive(Context c, boolean valid) throws Exception {
        File f = File.createTempFile("schedule-", ".zip", c.getCacheDir());
        String[][] files = {
            {"stops", "stop_id,stop_code,stop_name,stop_lat,stop_lon\nABC_01,C1,Origine,48.58,7.75\nEND_01,E1,Terminus,48.59,7.76\n"},
            {"routes", "route_id,route_short_name\nr,A\n"},
            {"trips", "route_id,service_id,trip_id,trip_headsign\nr,w,night,Terminus\nr,w,removed,Terminus\nr,added,extra,Terminus\n"},
            {"calendar", "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nw,1,1,1,1,1,1,1,20260101,20261231\n"},
            {"calendar_dates", "service_id,date,exception_type\nw,20261117,2\nadded,20261117,1\n"},
            {"stop_times", "trip_id,stop_id,stop_sequence,arrival_time,departure_time,pickup_type\n" + (valid ? "night,ABC_01,1,24:10:00,24:10:00,0\nnight,END_01,2,24:20:00,24:20:00,0\nremoved,ABC_01,1,12:00:00,12:00:00,0\nremoved,END_01,2,12:20:00,12:20:00,0\nextra,ABC_01,1,12:50:00,12:50:00,0\nextra,END_01,2,13:00:00,13:00:00,0\n" : "")}
        };
        try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(f))) {
            for (String[] file : files) { out.putNextEntry(new ZipEntry(file[0] + ".txt")); out.write(file[1].getBytes(StandardCharsets.UTF_8)); out.closeEntry(); }
        }
        return f;
    }
    @Test public void widgetsReadSchedulesOfflineWithCalendarsAndMidnight() throws Exception {
        Context c = RuntimeEnvironment.getApplication(); LocalTimetable.replace(c,"cts",archive(c,true));
        long midnight = Instant.parse("2026-11-16T23:00:00Z").toEpochMilli();
        JSONObject j = LocalTimetable.widget(c,"/api/widget/stop?refs=C1",midnight);
        assertTrue(j.getBoolean("scheduled"));
        assertFalse(j.getJSONArray("deps").getJSONObject(0).getBoolean("rt"));
        assertEquals(Instant.parse("2026-11-16T23:10:00Z").toEpochMilli(),j.getJSONArray("deps").getJSONObject(0).getJSONArray("t").getLong(0));
        long noon = Instant.parse("2026-11-17T10:00:00Z").toEpochMilli();
        JSONArray times = LocalTimetable.widget(c,"/api/widget/stop?refs=ABC",noon).getJSONArray("deps").getJSONObject(0).getJSONArray("t");
        assertEquals(1,times.length()); assertEquals(Instant.parse("2026-11-17T11:50:00Z").toEpochMilli(),times.getLong(0));
    }
    @Test public void brokenImportRollsBackAndRealtimeNeverCallsTheServer() throws Exception {
        Context c = RuntimeEnvironment.getApplication(); LocalTimetable.replace(c,"cts",archive(c,true));
        long noon = Instant.parse("2026-11-17T10:00:00Z").toEpochMilli();
        String before = LocalTimetable.widget(c,"/api/widget/stop?refs=C1",noon).toString();
        try { LocalTimetable.replace(c,"cts",archive(c,false)); fail("Archive vide acceptée"); } catch (IOException expected) {}
        assertEquals(before,LocalTimetable.widget(c,"/api/widget/stop?refs=C1",noon).toString());
        try { LocalTimetable.widget(c,"/api/widget/traffic"); fail("Temps réel activé"); } catch (IOException expected) { assertEquals("Bientôt disponible",expected.getMessage()); }
    }
    @Test public void conditionalSyncKeepsPublishedGenerationOnFailure() throws Exception {
        Context c = RuntimeEnvironment.getApplication();
        byte[] valid = java.nio.file.Files.readAllBytes(archive(c,true).toPath());
        okhttp3.mockwebserver.MockWebServer server = new okhttp3.mockwebserver.MockWebServer();
        server.start();
        server.enqueue(new okhttp3.mockwebserver.MockResponse().setHeader("ETag","\"official-v1\"").setBody(new okio.Buffer().write(valid)));
        java.lang.reflect.Method download = KummGtfs.class.getDeclaredMethod("download",Context.class,String.class,String.class);
        download.setAccessible(true);
        String url = server.url("/gtfs.zip").toString();
        try {
            download.invoke(null,c,"cts",url);
            android.content.SharedPreferences p = c.getSharedPreferences("official-gtfs",Context.MODE_PRIVATE);
            String revision = p.getString("cts.revision",""), database = p.getString("database","");
            assertFalse(revision.isEmpty()); assertFalse(database.isEmpty());
            server.takeRequest();
            server.enqueue(new okhttp3.mockwebserver.MockResponse().setResponseCode(304)); download.invoke(null,c,"cts",url);
            assertEquals("\"official-v1\"",server.takeRequest().getHeader("If-None-Match")); assertEquals(revision,p.getString("cts.revision",""));
            server.enqueue(new okhttp3.mockwebserver.MockResponse().setHeader("ETag", "\"official-v2\"").setBody(new okio.Buffer().write(valid)));
            download.invoke(null,c,"cts",url);
            assertEquals("\"official-v2\"",p.getString("cts.etag",""));
            assertEquals(revision,p.getString("cts.revision","")); assertEquals(database,p.getString("database",""));
            server.enqueue(new okhttp3.mockwebserver.MockResponse().setBody(new okio.Buffer().write(new byte[]{1,2,3})));
            try { download.invoke(null,c,"cts",url); fail("Archive corrompue acceptée"); } catch (java.lang.reflect.InvocationTargetException expected) {}
            assertEquals(revision,p.getString("cts.revision","")); assertEquals(database,p.getString("database",""));
            server.enqueue(new okhttp3.mockwebserver.MockResponse().setResponseCode(429).setHeader("Retry-After","3600"));
            try { download.invoke(null,c,"cts",url); fail("Limite ignorée"); } catch (java.lang.reflect.InvocationTargetException expected) {}
            assertTrue(p.getLong("cts.retry",0) >= System.currentTimeMillis()+3500000);
        } finally {server.shutdown();}
    }

    @Test public void scheduledChecksRespectTheTwentyMinuteWindowAndUpgradeTheExistingJob() {
        long now = 2_000_000, interval = KummGtfs.CHECK_INTERVAL;
        assertEquals(20 * 60_000L, interval);
        assertFalse(KummGtfs.needsCheck(now, now - interval + 1, 0, true, false));
        assertTrue(KummGtfs.needsCheck(now, now - interval, 0, true, false));
        assertFalse(KummGtfs.needsCheck(now, 0, now + 1, false, false));
        assertTrue(KummGtfs.needsCheck(now, now - 1, 0, false, false));

        Context c = RuntimeEnvironment.getApplication();
        android.app.job.JobScheduler scheduler = c.getSystemService(android.app.job.JobScheduler.class);
        scheduler.schedule(new android.app.job.JobInfo.Builder(7412, new android.content.ComponentName(c, GtfsJob.class))
            .setPeriodic(86_400_000).setRequiredNetworkType(android.app.job.JobInfo.NETWORK_TYPE_ANY).build());
        KummGtfs.schedule(c);
        assertEquals(interval, scheduler.getPendingJob(7412).getIntervalMillis());
        assertEquals(android.app.job.JobInfo.NETWORK_TYPE_ANY, scheduler.getPendingJob(7412).getNetworkType());
    }

    @Test public void bundledCtsSeedsAnOfflineInstallAndPreservesMoreRecentlyCheckedData() throws Exception {
        Context c = RuntimeEnvironment.getApplication();
        android.content.SharedPreferences p = c.getSharedPreferences("official-gtfs", Context.MODE_PRIVATE);
        String bundled = KummGtfs.installBundledCts(c);
        assertFalse(bundled.isEmpty());
        assertEquals(bundled, p.getString("cts.revision", ""));
        File directory = new File(c.getFilesDir(), "gtfs");
        assertTrue(new File(directory, "cts-" + bundled + ".zip").isFile());

        java.nio.file.Files.copy(archive(c, true).toPath(), new File(directory, "cts-newer.zip").toPath());
        p.edit().putLong("cts.checked", p.getLong("cts.checked", 0) + 60_000).putString("cts.revision", "newer").commit();
        assertEquals(bundled, KummGtfs.installBundledCts(c));
        assertEquals("newer", p.getString("cts.revision", ""));
    }

    @Test public void officialArchivesWhenProvided() throws Exception {
        String cts = System.getenv("KUMM_REAL_CTS"), ter = System.getenv("KUMM_REAL_TER");
        org.junit.Assume.assumeTrue(cts != null && ter != null);
        Context c = RuntimeEnvironment.getApplication();
        LocalTimetable.replace(c,"cts",new File(cts)); LocalTimetable.replace(c,"ter",new File(ter));
        JSONObject result = LocalTimetable.widget(c,"/api/widget/stop?sncf=87212027",System.currentTimeMillis());
        assertTrue(result.getBoolean("scheduled")); assertTrue(result.getJSONArray("deps").length()>0);
        JSONObject first = result.getJSONArray("deps").getJSONObject(0);
        assertEquals("TER",first.getString("l")); assertFalse(first.getBoolean("rt")); assertFalse(first.getString("d").matches("[0-9]+"));
    }

}
