package fr.kumm.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Alertes de descente pendant une navigation (web/src/journey.ts) : service au premier plan qui continue écran éteint ou application fermée.
 * - Avant de monter : l'heure d'arrivée du véhicule à l'arrêt de départ est relue toutes les 30 s ; 2 min avant, rappel
 *   « Pensez à valider votre titre de transport ».
 * - À bord : la position du téléphone (GPS) situe le voyageur sur le trajet ; la notification (rangée) indique le nombre
 *   d'arrêts restants, le prochain arrêt et la vitesse. À 5 arrêts, notification qui s'affiche puis se range ; à 2 arrêts,
 *   vibration ; juste avant l'arrêt de descente, alerte « Descendez au prochain arrêt » avec une vibration plus forte.
 * - Sa position (sans identifiant) est envoyée toutes les 10 s au serveur (POST /api/ride) : elle donne à tous la vraie
 *   position et la vitesse du véhicule, et apprend au serveur les vitesses réelles de chaque tronçon.
 * Sans position (refusée ou GPS indisponible), le suivi se fait d'après les horaires annoncés.
 * S'arrête à l'arrivée, si le voyageur quitte le trajet, au bout de 2 h, ou avec le bouton « Arrêter » de la notification.
 */
public class TripService extends Service implements LocationListener {
    static final String ACTION_START = "fr.kumm.app.TRIP_START", ACTION_STOP = "fr.kumm.app.TRIP_STOP", EXTRA_TRIP = "trip";
    private static final String CH_ONGOING = "trajet_fond", CH_STEP = "trajet_etapes", CH_ALERT = "trajet_alertes";
    private static final int ID_ONGOING = 4201, ID_ALERT = 4202;
    private static final long POLL_MS = 30_000, SEND_MS = 10_000, TICK_MS = 5_000, MAX_MS = 2 * 3600_000L;
    private static final double ON_ROUTE_M = 150, ALERT_M = 700, ARRIVED_M = 45;

    /** État lu par l'application (KummTrip.status) pour son bandeau */
    static volatile JSONObject status = null;

    private String base = "", id = "", line = "", dest = "", tripCode = "";
    private int color = 0xFF136342;
    private double[] lat, lon;
    private String[] names;
    private long[] arr;
    private int board = -1, alight = 0;
    private boolean boarded, reminded, arrived, finishing;
    /** dernier nombre d'arrêts annoncé (3, 2, puis 1) */
    private int announced;
    private double progress = -1;
    private Location last;
    private long started, lastSend, lastPoll;
    private int misses;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private LocationManager lm;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (finishing) return;
            long now = System.currentTimeMillis();
            if (now - started > MAX_MS || now > arr[alight] + 15 * 60_000L) { finish(null); return; }
            if (now - lastPoll > POLL_MS) { lastPoll = now; poll(); }
            update(now);
            handler.postDelayed(this, TICK_MS);
        }
    };

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!KummFeatures.REALTIME) { stopForeground(true); stopSelf(); return START_NOT_STICKY; }
        if (intent != null && ACTION_STOP.equals(intent.getAction())) { finish(null); return START_NOT_STICKY; }
        if (intent == null || !intent.hasExtra(EXTRA_TRIP)) { stopSelf(); return START_NOT_STICKY; }
        try { load(new JSONObject(intent.getStringExtra(EXTRA_TRIP))); }
        catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        channels();
        Notification n = ongoing(System.currentTimeMillis());
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID_ONGOING, n, hasLocation() ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID_ONGOING, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        startLocation();
        handler.removeCallbacks(tick);
        handler.post(tick);
        return START_NOT_STICKY;
    }

    private void load(JSONObject t) throws Exception {
        base = t.optString("base", "");
        id = t.getString("id"); line = t.optString("line", ""); dest = t.optString("dest", ""); tripCode = t.optString("n", "");
        try { color = Color.parseColor(t.optString("color", "#136342")); } catch (Exception ignored) { }
        JSONArray cs = t.getJSONArray("calls");
        int n = cs.length();
        lat = new double[n]; lon = new double[n]; names = new String[n]; arr = new long[n];
        for (int i = 0; i < n; i++) {
            JSONObject c = cs.getJSONObject(i);
            lat[i] = c.getDouble("lat"); lon[i] = c.getDouble("lon"); names[i] = c.optString("name", ""); arr[i] = c.optLong("arr", 0);
        }
        board = t.optInt("board", -1); alight = Math.max(0, Math.min(n - 1, t.optInt("alight", n - 1)));
        boarded = board < 0; reminded = boarded; announced = Integer.MAX_VALUE; arrived = false; finishing = false;
        progress = boarded ? -1 : board; started = System.currentTimeMillis(); lastSend = 0; lastPoll = started; misses = 0; last = null;
    }

    /* ---------- position ---------- */

    private boolean hasLocation() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startLocation() {
        if (!hasLocation()) return;
        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return;
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 0, this, Looper.getMainLooper());
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 0, this, Looper.getMainLooper());
        } catch (SecurityException ignored) { }
    }

    @Override public void onLocationChanged(Location l) {
        // position réseau (imprécise) ignorée quand le GPS répond
        if (last != null && LocationManager.NETWORK_PROVIDER.equals(l.getProvider()) && LocationManager.GPS_PROVIDER.equals(last.getProvider())
            && l.getTime() - last.getTime() < 15_000) return;
        last = l;
        if (!finishing) update(System.currentTimeMillis());
    }
    @Override public void onStatusChanged(String p, int s, Bundle b) { }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }

    private static double meters(double la1, double lo1, double la2, double lo2) {
        double kx = 111_320 * Math.cos(Math.toRadians(la1));
        return Math.hypot((lo2 - lo1) * kx, (la2 - la1) * 110_540);
    }

    /** Position sur le trajet : indice du tronçon + avancée (k + f), ou -1 si le point est loin du trajet */
    private double onRoute(double la, double lo, int from) {
        double best = Double.MAX_VALUE, at = -1;
        double kx = 111_320 * Math.cos(Math.toRadians(la)), ky = 110_540;
        for (int k = Math.max(0, from); k < lat.length - 1; k++) {
            double ax = (lon[k] - lo) * kx, ay = (lat[k] - la) * ky, bx = (lon[k + 1] - lo) * kx, by = (lat[k + 1] - la) * ky;
            double dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
            double f = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
            double d = Math.hypot(ax + f * dx, ay + f * dy);
            if (d < best) { best = d; at = k + f; }
        }
        return best <= ON_ROUTE_M ? at : -1;
    }

    /** Avancée d'après les horaires annoncés (sans position) */
    private double byTime(long now) {
        for (int k = 0; k < arr.length - 1; k++) {
            if (now < arr[k]) return k;
            if (now < arr[k + 1]) return k + (double) (now - arr[k]) / Math.max(1, arr[k + 1] - arr[k]);
        }
        return arr.length - 1;
    }

    private boolean freshGps(long now) { return last != null && now - last.getTime() < 20_000 && last.getAccuracy() < 80; }

    /* ---------- suivi ---------- */

    private void update(long now) {
        boolean gps = freshGps(now);
        double here = gps ? onRoute(last.getLatitude(), last.getLongitude(), (int) Math.floor(Math.max(0, progress)) - 1) : -1;
        double speed = gps && last.hasSpeed() ? last.getSpeed() : -1;
        if (!boarded) {
            long eta = arr[board] - now;
            if (!reminded && eta <= 120_000) {
                reminded = true;
                alert("Votre " + line + " arrive" + (eta > 45_000 ? " dans " + Math.round(eta / 60_000.0) + " min" : ""),
                    "Pensez à valider votre titre de transport en montant. Arrêt : " + names[board] + ".", false);
            }
            // monté : le téléphone suit le trajet après l'arrêt de départ en roulant ; sans position, d'après l'horaire
            boolean moved = here > board + 0.1 && speed > 2.5;
            if (moved || (!gps && byTime(now) > board + 0.3)) { boarded = true; progress = Math.max(board, here); }
        }
        if (boarded) {
            double p = here >= 0 ? here : (gps ? -1 : byTime(now));
            if (p > progress) progress = p;
            if (gps && here >= 0) send(now, speed);
            double toEnd = gps ? meters(last.getLatitude(), last.getLongitude(), lat[alight], lon[alight]) : Double.MAX_VALUE;
            if (!arrived && (progress >= alight - 0.03 || toEnd < ARRIVED_M)) {
                arrived = true;
                step("Vous y êtes !", "Arrivée à " + names[alight] + ". Bonne journée !");
                finish(4000L);
                return;
            }
            // 5 arrêts avant : notification qui s'affiche puis se range ; à 2 arrêts, vibration ; au dernier, alerte forte
            int r = remaining();
            boolean far = toEnd > ALERT_M && arr[alight] - now > 100_000;
            if (r == 1 && far) r = 0;   // long dernier tronçon : l'alerte attend d'être proche de l'arrêt
            if (r >= 1 && r <= 5 && r < announced && (r == 5 || r <= 2 || announced > 5)) {
                announced = r;
                if (r >= 3) step("Plus que " + r + " arrêts", "Descente à " + names[alight] + ".");
                else if (r == 2) alert("Plus que 2 arrêts", "Descente à " + names[alight] + " : préparez-vous.", false);
                else alert("Descendez au prochain arrêt", names[alight] + " : préparez-vous à descendre.", true);
            }
        }
        publish(now, speed);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && !finishing) nm.notify(ID_ONGOING, ongoing(now));
    }

    private int remaining() { return Math.max(0, alight - (int) Math.floor(Math.max(0, progress))); }

    private void publish(long now, double speed) {
        try {
            JSONObject s = new JSONObject();
            s.put("active", !finishing); s.put("id", id); s.put("line", line); s.put("dest", dest);
            s.put("boarded", boarded); s.put("remaining", remaining()); s.put("alight", names[alight]);
            s.put("board", board >= 0 ? names[board] : ""); s.put("eta", board >= 0 && !boarded ? Math.max(0, arr[board] - now) : 0);
            if (boarded) { int nx = Math.min(names.length - 1, (int) Math.floor(Math.max(0, progress)) + 1); s.put("next", names[nx]); }
            if (speed >= 0) s.put("speed", Math.round(speed * 3.6));
            status = s;
        } catch (Exception ignored) { }
    }

    /* ---------- serveur ---------- */

    /** Heures à jour de la course (retards) */
    private void poll() {
        if (base.isEmpty()) return;
        io.execute(() -> {
            try {
                String body = get("/api/trip?id=" + URLEncoder.encode(id, "UTF-8"));
                if (body == null) return;
                JSONArray cs = new JSONObject(body).getJSONArray("calls");
                if (cs.length() != arr.length) return;   // course modifiée : on garde les heures connues
                long[] a = new long[cs.length()];
                for (int i = 0; i < a.length; i++) a[i] = cs.getJSONObject(i).optLong("arr", arr[i]);
                handler.post(() -> arr = a);
            } catch (Exception ignored) { }
        });
    }

    private void send(long now, double speed) {
        if (base.isEmpty() || now - lastSend < SEND_MS) return;
        lastSend = now;
        final double la = last.getLatitude(), lo = last.getLongitude();
        io.execute(() -> {
            try {
                JSONObject b = new JSONObject();
                b.put("trip", id); b.put("lat", la); b.put("lon", lo);
                if (speed >= 0) b.put("speed", speed);
                int code = httpStatus("/api/ride", b.toString());
                handler.post(() -> {
                    if (code == 404) finish(null);                          // course terminée
                    else if (code == 409) { if (++misses >= 3) { alert("Trajet arrêté", "Vous semblez avoir quitté le " + line + ".", false); finish(3000L); } }
                    else if (code == 200) misses = 0;
                });
            } catch (Exception ignored) { }
        });
    }

    private HttpURLConnection open(String method, String path) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(base + path).openConnection();
        h.setRequestMethod(method); h.setConnectTimeout(8000); h.setReadTimeout(10_000);
        h.setRequestProperty("Origin", "https://localhost");
        return h;
    }

    private String get(String path) throws Exception {
        HttpURLConnection h = open("GET", path);
        try {
            if (h.getResponseCode() != 200) return null;
            try (InputStream in = h.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192]; int r;
                while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
                return out.toString("UTF-8");
            }
        } finally { h.disconnect(); }
    }

    private int httpStatus(String path, String body) throws Exception {
        HttpURLConnection h = open("POST", path);
        try {
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = h.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            return h.getResponseCode();
        } finally { h.disconnect(); }
    }

    /* ---------- notifications ---------- */

    private void channels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // notification permanente obligatoire pendant le suivi : rangée, sans icône dans la barre d'état
        NotificationChannel a = new NotificationChannel(CH_ONGOING, "Trajet en cours", NotificationManager.IMPORTANCE_MIN);
        a.setDescription("Arrêts restants pendant un trajet suivi");
        a.setShowBadge(false);
        NotificationChannel st = new NotificationChannel(CH_STEP, "Étapes du trajet", NotificationManager.IMPORTANCE_HIGH);
        st.setDescription("« Plus que 5 arrêts » : s'affiche quelques secondes, sans vibrer");
        st.enableVibration(false);
        st.setSound(null, null);
        NotificationChannel b = new NotificationChannel(CH_ALERT, "Descente et validation", NotificationManager.IMPORTANCE_HIGH);
        b.setDescription("Alerte avant votre arrêt de descente, rappel de validation avant de monter");
        b.enableVibration(true);
        b.setVibrationPattern(new long[] { 0, 400, 200, 400 });
        nm.createNotificationChannel(a);
        nm.createNotificationChannel(st);
        nm.createNotificationChannel(b);
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(WidgetCore.EXTRA_OPEN, "trajet");
        return PendingIntent.getActivity(this, 4201, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification ongoing(long now) {
        String title, text;
        if (!boarded) {
            long m = Math.max(0, Math.round((arr[board] - now) / 60_000.0));
            title = line + " vers " + dest;
            text = (m < 1 ? "Arrive à " + names[board] : "Arrive à " + names[board] + " dans " + m + " min") + " · descente à " + names[alight];
        } else {
            int r = remaining();
            title = r <= 1 ? "Prochain arrêt : " + names[alight] : "Plus que " + r + " arrêts";
            int nx = Math.min(names.length - 1, (int) Math.floor(Math.max(0, progress)) + 1);
            text = "Descente à " + names[alight] + (r > 1 ? " · prochain arrêt : " + names[nx] : "")
                + (last != null && last.hasSpeed() && freshGps(now) ? " · " + Math.round(last.getSpeed() * 3.6) + " km/h" : "");
        }
        Intent stop = new Intent(this, TripService.class).setAction(ACTION_STOP);
        PendingIntent ps = PendingIntent.getService(this, 4202, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CH_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_kumm).setColor(color)
            .setContentTitle(title).setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setSubText(tripCode.isEmpty() ? null : "Trajet " + tripCode)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true).setPriority(NotificationCompat.PRIORITY_MIN).setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setContentIntent(openApp()).addAction(0, "Arrêter", ps).build();
    }

    /** Étape du trajet : s'affiche en haut de l'écran quelques secondes, sans son ni vibration, puis se range */
    private void step(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.notify(ID_ALERT, new NotificationCompat.Builder(this, CH_STEP)
            .setSmallIcon(R.drawable.ic_stat_kumm).setColor(color).setContentTitle(title).setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH).setSilent(true).setAutoCancel(true).setTimeoutAfter(60_000)
            .setContentIntent(openApp()).build());
    }

    private void alert(String title, String text, boolean urgent) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat_kumm).setColor(color)
            .setContentTitle(title).setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(urgent ? NotificationCompat.CATEGORY_ALARM : NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true).setContentIntent(openApp());
        b.setVibrate(urgent ? new long[] { 0, 400, 200, 400, 200, 600 } : new long[] { 0, 300, 150, 300 });
        nm.notify(ID_ALERT, b.build());
    }

    /** Fin du trajet, tout de suite ou après un délai (le temps de lire « Vous êtes arrivé ») */
    private void finish(Long delayMs) {
        finishing = true;
        handler.removeCallbacks(tick);
        if (lm != null) { try { lm.removeUpdates(this); } catch (Exception ignored) { } }
        JSONObject s = status;
        if (s != null) { try { s.put("active", false); } catch (Exception ignored) { } }
        Runnable end = () -> { stopForeground(Service.STOP_FOREGROUND_REMOVE); stopSelf(); };
        if (delayMs != null) handler.postDelayed(end, delayMs); else end.run();
    }

    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (lm != null) { try { lm.removeUpdates(this); } catch (Exception ignored) { } }
        io.shutdown();
        super.onDestroy();
    }
}
