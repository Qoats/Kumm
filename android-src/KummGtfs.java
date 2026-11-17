package fr.kumm.app;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;
import java.util.zip.ZipFile;

/** Official schedule archives in private app storage. No Kumm server or SIRI API. */
@CapacitorPlugin(name = "KummGtfs")
public class KummGtfs extends Plugin {
    private static final Object LOCK = new Object();
    private static final String[] SOURCES = {"cts", "ter"};
    private static final String[] URLS = {
        "https://opendata.cts-strasbourg.eu/google_transit.zip",
        "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"
    };
    private static final long DAY = 86400000L;
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("official-gtfs", Context.MODE_PRIVATE); }
    private static File directory(Context c) throws IOException {
        File d = new File(c.getFilesDir(), "gtfs");
        if (!d.isDirectory() && !d.mkdirs()) throw new IOException("Stockage GTFS indisponible");
        return d;
    }
    static void schedule(Context c) {
        JobScheduler scheduler = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler.getPendingJob(7412) == null) scheduler.schedule(new JobInfo.Builder(7412,
            new ComponentName(c, GtfsJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(DAY).setPersisted(true).build());
    }
    @Override public void load() { schedule(getContext()); }
    @PluginMethod public void sync(PluginCall call) {
        new Thread(() -> {
            try { call.resolve(synchronize(getContext(), Boolean.TRUE.equals(call.getBoolean("manual", false)))); }
            catch (Exception e) { call.reject(e.getMessage()); }
        }, "kumm-gtfs").start();
    }
    @PluginMethod public void read(PluginCall call) {
        String source = call.getString("source", "");
        if (!source.equals("cts") && !source.equals("ter")) { call.reject("Source GTFS inconnue"); return; }
        new Thread(() -> {
            synchronized (LOCK) {
                try {
                    String revision = prefs(getContext()).getString(source + ".revision", "");
                    if (revision.isEmpty()) throw new IOException("Données non téléchargées");
                    File f = new File(directory(getContext()), source + "-" + revision + ".zip");
                    try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[65536]; int n;
                        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                        JSObject result = new JSObject(); result.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                        call.resolve(result);
                    }
                } catch (Exception e) { call.reject(e.getMessage()); }
            }
        }, "kumm-gtfs-read").start();
    }
    static JSObject synchronize(Context c, boolean manual) throws Exception {
        synchronized (LOCK) {
            JSObject result = new JSObject();
            for (int i = 0; i < SOURCES.length; i++) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Synchronisation interrompue");
                String s = SOURCES[i]; SharedPreferences p = prefs(c);
                long now = System.currentTimeMillis(), checked = p.getLong(s + ".checked", 0);
                String error = now < p.getLong(s + ".retry", 0) ? "Nouvel essai après la limite du fournisseur" : "";
                if ((manual || now - checked >= DAY) && now >= p.getLong(s + ".retry", 0)) {
                    try { download(c, s, URLS[i]); }
                    catch (Exception e) {
                        error = e.getMessage();
                        p.edit().putLong(s + ".retry", Math.max(p.getLong(s + ".retry", 0), now + 60000)).commit();
                    }
                }
                JSObject status = new JSObject();
                status.put("checked", p.getLong(s + ".checked", 0));
                status.put("revision", p.getString(s + ".revision", ""));
                status.put("etag", p.getString(s + ".etag", ""));
                status.put("modified", p.getString(s + ".modified", ""));
                status.put("error", error);
                result.put(s, status);
            }
            return result;
        }
    }
    private static void download(Context c, String source, String address) throws Exception {
        SharedPreferences p = prefs(c);
        HttpURLConnection h = (HttpURLConnection) new URL(address).openConnection();
        h.setConnectTimeout(15000); h.setReadTimeout(120000);
        h.setRequestProperty("User-Agent", "Kumm Android (official GTFS schedules; github.com/Qoats/Kumm)");
        String old = p.getString(source + ".revision", "");
        boolean exists = !old.isEmpty() && new File(directory(c), source + "-" + old + ".zip").isFile();
        if (exists) {
            String etag = p.getString(source + ".etag", ""), modified = p.getString(source + ".modified", "");
            if (!etag.isEmpty()) h.setRequestProperty("If-None-Match", etag);
            if (!modified.isEmpty()) h.setRequestProperty("If-Modified-Since", modified);
        }
        File candidate = new File(directory(c), source + ".part");
        try {
            int status = h.getResponseCode();
            if (status == 304 && exists) { p.edit().putLong(source + ".checked", System.currentTimeMillis()).putLong(source + ".retry", 0).commit(); return; }
            if (status != 200) {
                if (status == 429 || status == 503) {
                    long delay = 3600000;
                    try { delay = Math.max(60000, Long.parseLong(h.getHeaderField("Retry-After")) * 1000); }
                    catch (Exception ignored) {
                        try { delay = Math.max(60000, java.time.ZonedDateTime.parse(h.getHeaderField("Retry-After"),java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()-System.currentTimeMillis()); } catch (Exception invalid) {}
                    }
                    p.edit().putLong(source + ".retry", System.currentTimeMillis() + delay).commit();
                }
                throw new IOException("Source officielle HTTP " + status);
            }
            long size = 0;
            try (InputStream in = h.getInputStream(); FileOutputStream out = new FileOutputStream(candidate)) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("Synchronisation interrompue");
                    size += n; if (size > 64L * 1024 * 1024) throw new IOException("Archive GTFS trop volumineuse");
                    out.write(buf, 0, n);
                }
                out.getFD().sync();
            }
            try (ZipFile zip = new ZipFile(candidate)) {
                long expanded = 0;
                java.util.Enumeration<? extends java.util.zip.ZipEntry> entries = zip.entries();
                while (entries.hasMoreElements()) { long length = entries.nextElement().getSize(); expanded += Math.max(0,length); if (length > 256L*1024*1024 || expanded > 512L*1024*1024) throw new IOException("Contenu GTFS trop volumineux"); }
                for (String name : new String[]{"stops.txt", "routes.txt", "trips.txt", "stop_times.txt"})
                    if (zip.getEntry(name) == null) throw new IOException(name + " absent du GTFS");
                if (zip.getEntry("calendar.txt") == null && zip.getEntry("calendar_dates.txt") == null) throw new IOException("Calendrier GTFS absent");
            }
            if (Thread.currentThread().isInterrupted()) throw new IOException("Synchronisation interrompue");
            String revision = UUID.randomUUID().toString();
            String database = "timetable-" + revision + ".db";
            LocalTimetable.prepare(c, source, candidate, database);
            File next = new File(directory(c), source + "-" + revision + ".zip");
            if (!candidate.renameTo(next)) throw new IOException("Écriture GTFS impossible");
            if (Thread.currentThread().isInterrupted()) throw new IOException("Synchronisation interrompue");
            if (!p.edit().putString("database", database).putString(source + ".revision", revision).putLong(source + ".checked", System.currentTimeMillis())
                .putString(source + ".etag", h.getHeaderField("ETag")).putString(source + ".modified", h.getHeaderField("Last-Modified"))
                .putLong(source + ".retry", 0).commit()) throw new IOException("Écriture des métadonnées impossible");
            File[] databases = c.getDatabasePath(database).getParentFile().listFiles();
            if (databases != null) for (File file : databases) if (file.getName().startsWith("timetable-") && file.getName().endsWith(".db") && !file.getName().equals(database)) file.delete();
            File[] oldFiles = directory(c).listFiles();
            if (oldFiles != null) for (File f : oldFiles) if (f.getName().startsWith(source + "-") && !f.equals(next)) f.delete();
        } finally { candidate.delete(); h.disconnect(); }
    }
}
