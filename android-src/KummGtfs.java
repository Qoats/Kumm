package fr.kumm.app;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Process;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Scanner;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipFile;
import org.json.JSONObject;

/** Official schedule archives in private app storage. No Kumm server or SIRI API. */
@CapacitorPlugin(name = "KummGtfs")
public class KummGtfs extends Plugin {
    private static final Object LOCK = new Object();
    private static final Object DOWNLOAD_LOCK = new Object();
    private static final String[] SOURCES = {"cts", "ter"};
    private static final String[] URLS = {
        "https://opendata.cts-strasbourg.eu/google_transit.zip",
        "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"
    };
    static final long CHECK_INTERVAL = 20 * 60_000L;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    /** Sources whose widget database is still to be rebuilt: done in the background so the app gets its archives at once. */
    private static final Set<String> PENDING = ConcurrentHashMap.newKeySet();
    private static final AtomicBoolean PREPARING = new AtomicBoolean();
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("official-gtfs", Context.MODE_PRIVATE); }
    private static File directory(Context c) throws IOException {
        File d = new File(c.getFilesDir(), "gtfs");
        if (!d.isDirectory() && !d.mkdirs()) throw new IOException("Stockage GTFS indisponible");
        return d;
    }
    static void schedule(Context c) {
        JobScheduler scheduler = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        JobInfo previous = scheduler.getPendingJob(7412);
        if (previous == null || previous.getIntervalMillis() != CHECK_INTERVAL) scheduler.schedule(new JobInfo.Builder(7412,
            new ComponentName(c, GtfsJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(CHECK_INTERVAL).setPersisted(true).build());
    }
    @Override public void load() {
        schedule(getContext());
        connectivity = getContext().getSystemService(ConnectivityManager.class);
        if (connectivity == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            private Network ready;

            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                    if (!network.equals(ready)) {
                        ready = network;
                        notifyListeners("networkReady", new JSObject());
                    }
                } else if (network.equals(ready)) ready = null;
            }

            @Override public void onLost(Network network) { if (network.equals(ready)) ready = null; }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
    }

    @Override protected void handleOnDestroy() {
        if (networkCallback != null) connectivity.unregisterNetworkCallback(networkCallback);
    }

    private static boolean hasInternet(Context c) {
        ConnectivityManager manager = c.getSystemService(ConnectivityManager.class);
        Network network = manager == null ? null : manager.getActiveNetwork();
        NetworkCapabilities caps = network == null ? null : manager.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    static boolean needsCheck(long now, long checked, long retryAfter, boolean hasArchive, boolean manual) {
        return now >= retryAfter && (manual || !hasArchive || checked <= 0 || now - checked >= CHECK_INTERVAL);
    }
    @PluginMethod public void cached(PluginCall call) {
        new Thread(() -> {
            try {
                Context c = getContext();
                JSObject result = new JSObject();
                synchronized (LOCK) {
                    String bundled = seedAvailableCts(c);
                    for (String source : SOURCES) result.put(source, status(prefs(c), source, ""));
                    if (!bundled.isEmpty() && bundled.equals(prefs(c).getString("cts.revision", ""))) {
                        result.getJSONObject("cts").put("bundled", true);
                    }
                }
                call.resolve(result);
                if (!PENDING.isEmpty()) prepareWidgetsInBackground(c);
            } catch (Exception e) { call.reject(e.getMessage()); }
        }, "kumm-gtfs-cache").start();
    }
    @PluginMethod public void sync(PluginCall call) {
        new Thread(() -> {
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
            try { call.resolve(synchronize(getContext(), Boolean.TRUE.equals(call.getBoolean("manual", false)), true)); }
            catch (Exception e) { call.reject(e.getMessage()); }
        }, "kumm-gtfs").start();
    }
    @PluginMethod public void read(PluginCall call) {
        String source = call.getString("source", "");
        if (!source.equals("cts") && !source.equals("ter")) { call.reject("Source GTFS inconnue"); return; }
        new Thread(() -> {
            synchronized (LOCK) {
                try {
                    String revision = call.getString("revision", prefs(getContext()).getString(source + ".revision", ""));
                    if (!revision.matches("[0-9a-f-]{16,36}")) throw new IOException("Données non téléchargées");
                    File f = new File(directory(getContext()), source + "-" + revision + ".zip");
                    if (!f.isFile()) throw new IOException("Archive GTFS indisponible");
                    JSObject result = new JSObject(); result.put("path", f.getAbsolutePath());
                    call.resolve(result);
                } catch (Exception e) { call.reject(e.getMessage()); }
            }
        }, "kumm-gtfs-read").start();
    }
    static JSObject synchronize(Context c, boolean manual) throws Exception { return synchronize(c, manual, false); }
    /** deferWidgets: the SQLite copy for widgets (slow import of every stop time) is rebuilt after the archives are published. */
    static JSObject synchronize(Context c, boolean manual, boolean deferWidgets) throws Exception {
        JSObject result;
        synchronized (DOWNLOAD_LOCK) {
            result = new JSObject();
            synchronized (LOCK) { seedAvailableCts(c); }
            for (int i = 0; i < SOURCES.length; i++) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Synchronisation interrompue");
                String s = SOURCES[i]; SharedPreferences p = prefs(c);
                long now = System.currentTimeMillis(), checked = p.getLong(s + ".checked", 0), retry = p.getLong(s + ".retry", 0);
                String revision = p.getString(s + ".revision", "");
                boolean exists = !revision.isEmpty() && new File(directory(c), s + "-" + revision + ".zip").isFile();
                boolean online = hasInternet(c);
                String error = now < retry ? "Nouvel essai après la limite du fournisseur" : !exists && !online ? "Connexion indisponible" : "";
                if (online && needsCheck(now, checked, retry, exists, manual)) {
                    try { download(c, s, URLS[i], deferWidgets); }
                    catch (Exception e) {
                        error = e.getMessage();
                        if (Thread.currentThread().isInterrupted()) throw e;
                        p.edit().putLong(s + ".retry", Math.max(p.getLong(s + ".retry", 0), now + 60000)).commit();
                    }
                }
                result.put(s, status(p, s, error));
            }
        }
        if (deferWidgets) {
            // widget database out of date (never built, or the process stopped before the end): rebuild it in the background
            SharedPreferences p = prefs(c);
            for (String s : SOURCES) { String r = p.getString(s + ".revision", ""); if (!r.isEmpty() && !r.equals(p.getString(s + ".dbrevision", ""))) PENDING.add(s); }
            if (!PENDING.isEmpty()) prepareWidgetsInBackground(c);
        }
        return result;
    }

    private static JSObject status(SharedPreferences p, String source, String error) {
        JSObject status = new JSObject();
        status.put("checked", p.getLong(source + ".checked", 0));
        status.put("revision", p.getString(source + ".revision", ""));
        status.put("etag", p.getString(source + ".etag", ""));
        status.put("modified", p.getString(source + ".modified", ""));
        status.put("error", error);
        return status;
    }

    private static String seedAvailableCts(Context c) {
        try { return installBundledCts(c); }
        catch (Exception e) { android.util.Log.w("KummGtfs", "Horaires CTS embarqués illisibles", e); return ""; }
    }

    /** Called under LOCK. Keep the downloaded copy if it was checked at least as recently as the build. */
    static String installBundledCts(Context c) throws Exception {
        JSONObject manifest;
        try (InputStream in = c.getAssets().open("public/data/manifest.json");
             Scanner reader = new Scanner(in, "UTF-8").useDelimiter("\\A")) {
            manifest = new JSONObject(reader.next());
        } catch (FileNotFoundException e) { return ""; }
        long generated = Instant.parse(manifest.getString("generated")).toEpochMilli();
        JSONObject source = manifest.getJSONObject("sources").getJSONObject("cts");
        String revision = source.getString("revision");
        if (!revision.matches("[0-9a-f]{16}")) throw new IOException("Révision CTS invalide");
        SharedPreferences p = prefs(c);
        File dir = directory(c);
        String old = p.getString("cts.revision", "");
        if (!old.isEmpty() && new File(dir, "cts-" + old + ".zip").isFile()) {
            if (old.equals(revision)) {
                if (p.getString("cts.modified", "").isEmpty()) p.edit().putString("cts.modified", source.optString("publishedAt", "")).apply();
                return revision;
            }
            if (p.getLong("cts.checked", 0) >= generated) return revision;
        }
        File candidate = new File(dir, "cts-bundled.part");
        try (InputStream in = c.getAssets().open("public/data/cts.zip")) {
            if (!revision.equals(copyArchive(in, candidate))) throw new IOException("Empreinte du GTFS CTS invalide");
            validateArchive(candidate);
            if (!candidate.renameTo(new File(dir, "cts-" + revision + ".zip"))) throw new IOException("Écriture GTFS impossible");
            if (!p.edit().putString("cts.revision", revision).putLong("cts.checked", generated)
                .putString("cts.etag", source.optString("etag", "")).putString("cts.modified", source.optString("publishedAt", ""))
                .commit()) throw new IOException("Écriture des métadonnées impossible");
            if (!revision.equals(p.getString("cts.dbrevision", ""))) PENDING.add("cts");
        } finally { candidate.delete(); }
        return revision;
    }

    private static String copyArchive(InputStream in, File candidate) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long size = 0;
        try (FileOutputStream out = new FileOutputStream(candidate)) {
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Synchronisation interrompue");
                size += n; if (size > 64L * 1024 * 1024) throw new IOException("Archive GTFS trop volumineuse");
                out.write(buf, 0, n);
                digest.update(buf, 0, n);
            }
            out.getFD().sync();
        }
        StringBuilder revision = new StringBuilder(16);
        byte[] hash = digest.digest();
        for (int i = 0; i < 8; i++) revision.append(String.format(java.util.Locale.ROOT, "%02x", hash[i] & 255));
        return revision.toString();
    }

    private static void validateArchive(File candidate) throws IOException {
        try (ZipFile zip = new ZipFile(candidate)) {
            long expanded = 0;
            java.util.Enumeration<? extends java.util.zip.ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) { long length = entries.nextElement().getSize(); expanded += Math.max(0,length); if (length > 256L*1024*1024 || expanded > 512L*1024*1024) throw new IOException("Contenu GTFS trop volumineux"); }
            for (String name : new String[]{"stops.txt", "routes.txt", "trips.txt", "stop_times.txt"})
                if (zip.getEntry(name) == null) throw new IOException(name + " absent du GTFS");
            if (zip.getEntry("calendar.txt") == null && zip.getEntry("calendar_dates.txt") == null) throw new IOException("Calendrier GTFS absent");
        }
    }
    private static void download(Context c, String source, String address) throws Exception { download(c, source, address, false); }
    private static void prepareWidgetsInBackground(Context c) {
        if (!PREPARING.compareAndSet(false, true)) return;
        Context app = c.getApplicationContext();
        new Thread(() -> {
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
            try {
                while (!PENDING.isEmpty()) {
                    for (String source : SOURCES) {
                        if (!PENDING.remove(source)) continue;
                        try {
                            SharedPreferences p = prefs(app);
                            String revision = p.getString(source + ".revision", "");
                            File zip = new File(directory(app), source + "-" + revision + ".zip");
                            if (revision.isEmpty() || !zip.isFile()) continue;
                            String database = "timetable-" + UUID.randomUUID() + ".db";
                            LocalTimetable.prepare(app, source, zip, database);
                            p.edit().putString("database", database).putString(source + ".dbrevision", revision).commit();
                            File[] databases = app.getDatabasePath(database).getParentFile().listFiles();
                            if (databases != null) for (File file : databases) if (file.getName().startsWith("timetable-") && file.getName().endsWith(".db") && !file.getName().startsWith(database)) file.delete();
                        } catch (Exception ignored) { /* Widgets keep their previous data; the app itself reads the archives. */ }
                    }
                }
            } finally { PREPARING.set(false); }
        }, "kumm-gtfs-widgets").start();
    }
    private static void download(Context c, String source, String address, boolean deferWidgets) throws Exception {
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
            String revision;
            try (InputStream in = h.getInputStream()) { revision = copyArchive(in, candidate); }
            if (exists && old.equals(revision)) {
                markChecked(p.edit(), source, h).commit();
                return;
            }
            validateArchive(candidate);
            if (Thread.currentThread().isInterrupted()) throw new IOException("Synchronisation interrompue");
            String database = "timetable-" + revision + ".db";
            if (!deferWidgets) LocalTimetable.prepare(c, source, candidate, database);
            File next = new File(directory(c), source + "-" + revision + ".zip");
            synchronized (LOCK) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Synchronisation interrompue");
                if (!candidate.renameTo(next)) throw new IOException("Écriture GTFS impossible");
                SharedPreferences.Editor published = markChecked(p.edit().putString(source + ".revision", revision), source, h);
                if (!deferWidgets) published.putString("database", database);
                if (!published.commit()) throw new IOException("Écriture des métadonnées impossible");
                if (deferWidgets) PENDING.add(source);
                File[] oldFiles = directory(c).listFiles();
                String previous = source + "-" + old + ".zip";
                if (oldFiles != null) for (File f : oldFiles) {
                    if (f.getName().startsWith(source + "-") && !f.equals(next) && !f.getName().equals(previous)) f.delete();
                }
            }
            if (!deferWidgets) {
                File[] databases = c.getDatabasePath(database).getParentFile().listFiles();
                if (databases != null) for (File file : databases) if (file.getName().startsWith("timetable-") && file.getName().endsWith(".db") && !file.getName().equals(database)) file.delete();
            }
        } finally { candidate.delete(); h.disconnect(); }
    }

    private static SharedPreferences.Editor markChecked(SharedPreferences.Editor edit, String source, HttpURLConnection h) {
        return edit.putLong(source + ".checked", System.currentTimeMillis()).putLong(source + ".retry", 0)
            .putString(source + ".etag", h.getHeaderField("ETag")).putString(source + ".modified", h.getHeaderField("Last-Modified"));
    }
}
