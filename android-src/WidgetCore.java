package fr.kumm.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.location.Location;
import android.location.LocationManager;
import android.view.View;
import android.widget.RemoteViews;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widgets Kumm de l'écran d'accueil : réglages, téléchargement des données (serveur Kumm, /api/widget/…) et dessin.
 * - L'application transmet ses données (adresse du serveur, couleurs des lignes, favoris, lignes suivies, dernière position)
 *   par le module KummWidgets ; chaque widget garde son propre choix (arrêt, trajet, station) sous la clé « w<id> ».
 * - Android met à jour les widgets toutes les 30 min au plus souvent ; ils sont aussi actualisés par le bouton ↻,
 *   à l'ouverture et à la fermeture de Kumm. Les passages sont donc affichés en heure (« 18:44 »), pas en minutes.
 */
public final class WidgetCore {
    private WidgetCore() {}

    static final String PREFS = "kumm_widgets";
    static final String ACTION_REFRESH = "fr.kumm.app.WIDGET_REFRESH";
    static final String EXTRA_OPEN = "kumm_open";

    /** Tous les types de widgets et leur classe (un fournisseur par type, déclaré dans le manifeste) */
    static final Class<?>[] PROVIDERS = {
        StopWidget.class, TripWidget.class, TripSmallWidget.class, NearbyWidget.class, TrafficWidget.class, BikeWidget.class, ShortcutsWidget.class
    };

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static JSONObject json(String s) { try { return s == null ? new JSONObject() : new JSONObject(s); } catch (Exception e) { return new JSONObject(); } }

    static JSONObject shared(Context c) { return json(prefs(c).getString("sync", null)); }
    static JSONObject config(Context c, int id) { return json(prefs(c).getString("w" + id, null)); }

    /** Demande la mise à jour de tous les widgets posés, quel que soit leur type */
    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        for (Class<?> k : PROVIDERS) {
            int[] ids = m.getAppWidgetIds(new ComponentName(c, k));
            if (ids.length == 0) continue;
            Intent i = new Intent(c, k).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            c.sendBroadcast(i);
        }
    }

    /** Demande la mise à jour d'un seul widget */
    static void refreshOne(Context c, int id) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        android.appwidget.AppWidgetProviderInfo info = m.getAppWidgetInfo(id);
        if (info == null) return;
        Intent i = new Intent().setComponent(info.provider).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, new int[] { id });
        c.sendBroadcast(i);
    }

    /* ---------- réseau ---------- */

    static JSONObject get(Context c, String path) throws Exception {
        JSONObject s = shared(c);
        String base = s.optString("base", "");
        if (base.isEmpty()) throw new Exception("Ouvrez Kumm une première fois");
        HttpURLConnection h = (HttpURLConnection) new URL(base + path).openConnection();
        h.setConnectTimeout(8000);
        h.setReadTimeout(8000);
        // le serveur reconnaît l'application Android à son origine (accès privé), et à sa clé si elle est configurée
        h.setRequestProperty("Origin", "https://localhost");
        if (!s.optString("key", "").isEmpty()) h.setRequestProperty("X-App-Key", s.optString("key"));
        try {
            int code = h.getResponseCode();
            InputStream in = code < 400 ? h.getInputStream() : h.getErrorStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while (in != null && (n = in.read(buf)) > 0) out.write(buf, 0, n);
            JSONObject j = json(out.toString("UTF-8"));
            if (code >= 400) throw new Exception(j.optString("erreur", "Serveur indisponible (" + code + ")"));
            return j;
        } finally { h.disconnect(); }
    }

    static String enc(String s) { try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; } }

    static String join(JSONArray a) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; a != null && i < a.length(); i++) { if (b.length() > 0) b.append(','); b.append(a.optString(i)); }
        return b.toString();
    }

    /* ---------- dessin ---------- */

    static float dp(Context c) { return c.getResources().getDisplayMetrics().density; }

    static int color(String hex, int fallback) { try { return Color.parseColor(hex); } catch (Exception e) { return fallback; } }

    /** Couleur de fond et de texte d'une ligne, transmises par l'application (mêmes couleurs que dans Kumm) */
    static int[] lineColors(Context c, String line) {
        JSONObject s = shared(c);
        JSONObject bg = s.optJSONObject("colors"), fg = s.optJSONObject("text");
        int b = color(bg != null ? bg.optString(line, "") : "", "TER".equals(line) ? 0xFF7B1FA2 : 0xFF1296A8);
        int f = color(fg != null ? fg.optString(line, "") : "", Color.WHITE);
        return new int[] { b, f };
    }

    /** Pastille arrondie d'une ligne (« C », « 15 »…) */
    static Bitmap chip(Context c, String text, int bg, int fg, float heightDp) {
        float d = dp(c), h = heightDp * d;
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setTextSize(h * 0.52f);
        float w = Math.max(h * 1.25f, p.measureText(text) + h * 0.55f);
        Bitmap b = Bitmap.createBitmap((int) Math.ceil(w), (int) Math.ceil(h), Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        p.setColor(bg);
        cv.drawRoundRect(new RectF(0, 0, w, h), h * 0.3f, h * 0.3f, p);
        p.setColor(fg);
        p.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics fm = p.getFontMetrics();
        cv.drawText(text, w / 2, h / 2 - (fm.ascent + fm.descent) / 2, p);
        return b;
    }

    /** Barre de remplissage (vélos ou places) */
    static Bitmap bar(Context c, float ratio, int fg, int track, float widthDp) {
        float d = dp(c), w = widthDp * d, h = 6 * d;
        Bitmap b = Bitmap.createBitmap((int) w, (int) h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(track);
        cv.drawRoundRect(new RectF(0, 0, w, h), h / 2, h / 2, p);
        p.setColor(fg);
        cv.drawRoundRect(new RectF(0, 0, Math.max(h, w * Math.max(0, Math.min(1, ratio))), h), h / 2, h / 2, p);
        return b;
    }

    static String hm(long t) { return new SimpleDateFormat("HH:mm", Locale.FRANCE).format(new Date(t)); }

    /** Ouvre Kumm sur un écran précis (« stop:ID », « config:ID:type », « carte »…) ; un code de requête par bouton */
    static PendingIntent open(Context c, int widgetId, int slot, String what) {
        Intent i = new Intent(c, MainActivity.class)
            .setAction("fr.kumm.app.OPEN." + widgetId + "." + slot)
            .putExtra(EXTRA_OPEN, what)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, widgetId * 16 + slot, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Bouton ↻ : met à jour ce widget */
    static PendingIntent refresh(Context c, Class<?> provider, int widgetId) {
        Intent i = new Intent(c, provider).setAction(ACTION_REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        return PendingIntent.getBroadcast(c, widgetId * 16 + 15, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static int res(Context c, String type, String name) { return c.getResources().getIdentifier(name, type, c.getPackageName()); }
    static int id(Context c, String name) { return res(c, "id", name); }

    /* ---------- widgets ---------- */

    /** Liste de passages (arrêt favori, arrêt le plus proche) : jusqu'à 4 lignes de 2 horaires */
    static void fillDepartures(Context c, RemoteViews v, JSONArray deps, int rows) {
        int ink = c.getResources().getColor(res(c, "color", "w_ink"), null);
        for (int r = 0; r < 4; r++) {
            int row = id(c, "row" + r);
            JSONObject g = deps != null ? deps.optJSONObject(r) : null;
            if (g == null || r >= rows) { v.setViewVisibility(row, View.GONE); continue; }
            v.setViewVisibility(row, View.VISIBLE);
            String line = g.optString("l");
            int[] lc = lineColors(c, line);
            v.setImageViewBitmap(id(c, "chip" + r), chip(c, line, lc[0], lc[1], 26));
            v.setTextViewText(id(c, "dest" + r), g.optString("d"));
            JSONArray t = g.optJSONArray("t");
            v.setTextViewText(id(c, "ta" + r), t != null && t.length() > 0 ? hm(t.optLong(0)) + (g.optBoolean("rt") ? " •" : "") : "");
            v.setTextViewText(id(c, "tb" + r), t != null && t.length() > 1 ? hm(t.optLong(1)) : "");
            v.setTextColor(id(c, "ta" + r), ink);
        }
    }

    /** Dernière position connue : celle d'Android si Kumm y a accès, sinon celle transmise à la dernière ouverture de Kumm */
    static double[] position(Context c) {
        try {
            if (c.checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
                Location best = null;
                for (String p : lm.getProviders(true)) {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                }
                JSONObject s = shared(c).optJSONObject("pos");
                long appT = s != null ? s.optLong("t", 0) : 0;
                if (best != null && best.getTime() >= appT) return new double[] { best.getLatitude(), best.getLongitude(), best.getTime() };
            }
        } catch (Exception ignored) { /* position indisponible */ }
        JSONObject p = shared(c).optJSONObject("pos");
        if (p == null || !p.has("lat")) return null;
        return new double[] { p.optDouble("lat"), p.optDouble("lon"), p.optLong("t", 0) };
    }

    /** Construit l'affichage d'un widget (appelé hors du fil principal : peut télécharger) */
    /* ---------- thème : celui choisi dans l'application (Réglages › Apparence), transmis par KummWidgets.sync ---------- */
    static final java.util.Set<String> PALETTES = new java.util.HashSet<>(java.util.Arrays.asList("light", "sand", "dark", "ocean", "night", "contrast", "paper", "ink"));
    /** Textes de chaque widget : couleur principale, puis secondaire */
    static String[][] themedTexts(String type) {
        switch (type) {
            case "stop": case "nearby": return new String[][] {
                { "w_title", "dest0", "dest1", "dest2", "dest3", "ta0", "ta1", "ta2", "ta3" }, { "w_sub", "w_msg", "tb0", "tb1", "tb2", "tb3" } };
            case "trip": return new String[][] { { "w_dest", "w_time" }, { "w_next", "w_from" } };
            case "tripmini": return new String[][] { { "w_time", "w_dest" }, {} };
            case "traffic": return new String[][] { { "w_title" }, { "w_sub" } };
            case "poi": return new String[][] { { "w_title", "w_big" }, { "w_sub" } };
            default: return new String[][] { {}, {} };
        }
    }

    /** Fond (un fond prêt par thème : coins arrondis sur tous les Android) et couleurs des textes ; sans thème reçu : jour / nuit d'Android */
    static RemoteViews themed(Context c, String type, RemoteViews v) {
        JSONObject sh = shared(c), t = sh != null ? sh.optJSONObject("theme") : null;
        if (v == null || t == null || !PALETTES.contains(t.optString("palette"))) return v;
        String p = t.optString("palette");
        v.setInt(id(c, "w_root"), "setBackgroundResource", res(c, "drawable", "w_bg_" + p));
        if (type.equals("stop") || type.equals("nearby")) v.setInt(id(c, "w_refresh"), "setBackgroundResource", res(c, "drawable", "w_btn_" + p));
        String[][] ids = themedTexts(type);
        int ink = color(t.optString("ink"), Color.BLACK), mute = color(t.optString("mute"), Color.GRAY);
        for (String n : ids[0]) v.setTextColor(id(c, n), ink);
        for (String n : ids[1]) v.setTextColor(id(c, n), mute);
        return v;
    }

    static RemoteViews build(Context c, String type, int widgetId, Class<?> provider) {
        return themed(c, type, buildRaw(c, type, widgetId, provider));
    }

    static RemoteViews buildRaw(Context c, String type, int widgetId, Class<?> provider) {
        JSONObject cfg = config(c, widgetId);
        String pkg = c.getPackageName();
        switch (type) {
            case "stop":
            case "nearby": {
                RemoteViews v = new RemoteViews(pkg, res(c, "layout", "w_list"));
                v.setOnClickPendingIntent(id(c, "w_refresh"), refresh(c, provider, widgetId));
                v.setViewVisibility(id(c, "w_msg"), View.GONE);
                try {
                    JSONObject j;
                    if (type.equals("stop")) {
                        if (!cfg.has("refs") && !cfg.has("sncf")) return unconfigured(c, v, widgetId, "stop", "Touchez pour choisir l'arrêt");
                        v.setTextViewText(id(c, "w_title"), cfg.optString("name"));
                        v.setOnClickPendingIntent(id(c, "w_root"), open(c, widgetId, 0, "stop:" + cfg.optString("stopId")));
                        // directions choisies à la pose du widget (aucune = toutes)
                        JSONArray only = cfg.optJSONArray("only");
                        StringBuilder o = new StringBuilder();
                        for (int i = 0; only != null && i < only.length(); i++) { if (o.length() > 0) o.append('~'); o.append(only.optString(i)); }
                        j = get(c, "/api/widget/stop?refs=" + enc(join(cfg.optJSONArray("refs"))) + (cfg.optString("sncf").isEmpty() ? "" : "&sncf=" + enc(cfg.optString("sncf")))
                            + (o.length() > 0 ? "&only=" + enc(o.toString()) : ""));
                    } else {
                        v.setOnClickPendingIntent(id(c, "w_root"), open(c, widgetId, 0, "carte"));
                        double[] pos = position(c);
                        if (pos == null) { v.setTextViewText(id(c, "w_title"), "Arrêt le plus proche"); return message(c, v, "Ouvrez Kumm avec la position activée"); }
                        j = get(c, "/api/widget/nearby?lat=" + pos[0] + "&lon=" + pos[1]);
                        v.setTextViewText(id(c, "w_title"), j.optString("name", "Arrêt le plus proche"));
                        if (j.has("dist")) {
                            int m = j.optInt("dist");
                            v.setTextViewText(id(c, "w_sub"), "à " + m + " m · " + Math.max(1, Math.round(m / 75f)) + " min à pied");
                        }
                    }
                    JSONArray deps = j.optJSONArray("deps");
                    if (deps == null || deps.length() == 0) return message(c, v, "Aucun passage pour le moment");
                    fillDepartures(c, v, deps, 4);
                    if (type.equals("stop")) v.setTextViewText(id(c, "w_sub"), "màj " + hm(System.currentTimeMillis()));
                } catch (Exception e) { return message(c, v, e.getMessage() != null ? e.getMessage() : "Serveur injoignable"); }
                return v;
            }
            case "trip":
            case "tripmini": {
                RemoteViews v = new RemoteViews(pkg, res(c, "layout", type.equals("trip") ? "w_trip" : "w_trip_small"));
                if (!cfg.has("line")) {
                    v.setTextViewText(id(c, "w_time"), "—");
                    v.setTextViewText(id(c, "w_dest"), "Touchez pour choisir");
                    v.setOnClickPendingIntent(id(c, "w_root"), open(c, widgetId, 0, "config:" + widgetId + ":" + type));
                    return v;
                }
                String line = cfg.optString("line"), dest = cfg.optString("dest");
                int[] lc = lineColors(c, line);
                v.setImageViewBitmap(id(c, "w_chip"), chip(c, line, lc[0], lc[1], type.equals("trip") ? 26 : 30));
                v.setTextViewText(id(c, "w_dest"), (type.equals("trip") ? "→ " : "") + dest);
                v.setOnClickPendingIntent(id(c, "w_root"), open(c, widgetId, 0, "stop:" + cfg.optString("stopId")));
                if (type.equals("trip")) v.setTextViewText(id(c, "w_from"), "depuis " + cfg.optString("name"));
                try {
                    JSONObject j = get(c, "/api/widget/stop?refs=" + enc(join(cfg.optJSONArray("refs"))) + (cfg.optString("sncf").isEmpty() ? "" : "&sncf=" + enc(cfg.optString("sncf"))));
                    JSONArray deps = j.optJSONArray("deps");
                    JSONObject g = null;
                    for (int i = 0; deps != null && i < deps.length(); i++) {
                        JSONObject x = deps.optJSONObject(i);
                        if (x != null && line.equals(x.optString("l")) && dest.equals(x.optString("d"))) { g = x; break; }
                    }
                    JSONArray t = g != null ? g.optJSONArray("t") : null;
                    if (t == null || t.length() == 0) {
                        v.setTextViewText(id(c, "w_time"), "—");
                        if (type.equals("trip")) v.setTextViewText(id(c, "w_next"), "Pas de passage pour le moment");
                        return v;
                    }
                    v.setTextViewText(id(c, "w_time"), hm(t.optLong(0)) + (g.optBoolean("rt") && type.equals("trip") ? " •" : ""));
                    if (type.equals("trip")) {
                        StringBuilder b = new StringBuilder();
                        for (int i = 1; i < t.length(); i++) b.append(i == 1 ? "puis " : " · ").append(hm(t.optLong(i)));
                        v.setTextViewText(id(c, "w_next"), b.toString());
                    }
                } catch (Exception e) {
                    v.setTextViewText(id(c, "w_time"), "—");
                    if (type.equals("trip")) v.setTextViewText(id(c, "w_next"), "Serveur injoignable");
                }
                return v;
            }
            case "traffic": {
                RemoteViews v = new RemoteViews(pkg, res(c, "layout", "w_traffic"));
                v.setOnClickPendingIntent(id(c, "w_root"), open(c, widgetId, 0, "msgs"));
                JSONArray lines = shared(c).optJSONArray("lines");
                String ls = lines != null && lines.length() > 0 ? join(lines) : "*";
                try {
                    JSONObject j = get(c, "/api/widget/traffic?lines=" + enc(ls));
                    int n = j.optInt("n");
                    JSONArray items = j.optJSONArray("items");
                    JSONObject first = items != null ? items.optJSONObject(0) : null;
                    String who = ls.equals("*") ? "le réseau" : "vos lignes";
                    if (n == 0) {
                        v.setImageViewBitmap(id(c, "w_badge"), chip(c, "✓", 0xFF1E9E57, Color.WHITE, 34));
                        v.setTextViewText(id(c, "w_title"), "Tout roule sur " + who);
                        v.setTextViewText(id(c, "w_sub"), (ls.equals("*") ? "" : ls.replace(",", " · ") + " — ") + "vérifié à " + hm(System.currentTimeMillis()));
                    } else if (n == 1 && first != null) {
                        boolean inc = "disruption".equals(first.optString("c"));
                        v.setImageViewBitmap(id(c, "w_badge"), chip(c, "!", inc ? 0xFFE53935 : 0xFFF29400, Color.WHITE, 34));
                        v.setTextViewText(id(c, "w_title"), first.optString("t"));
                        v.setTextViewText(id(c, "w_sub"), first.optString("p") + " · touchez pour le détail");
                    } else {
                        v.setImageViewBitmap(id(c, "w_badge"), chip(c, String.valueOf(n), first != null && "disruption".equals(first.optString("c")) ? 0xFFE53935 : 0xFFF29400, Color.WHITE, 34));
                        v.setTextViewText(id(c, "w_title"), n + " perturbations sur " + who);
                        v.setTextViewText(id(c, "w_sub"), (first != null ? first.optString("t") : "") + " · touchez pour le détail");
                    }
                } catch (Exception e) {
                    v.setImageViewBitmap(id(c, "w_badge"), chip(c, "?", 0xFF8A9A92, Color.WHITE, 34));
                    v.setTextViewText(id(c, "w_title"), "Infos trafic indisponibles");
                    v.setTextViewText(id(c, "w_sub"), e.getMessage() != null ? e.getMessage() : "Serveur injoignable");
                }
                return v;
            }
            case "poi": {
                RemoteViews v = new RemoteViews(pkg, res(c, "layout", "w_bike"));
                if (!cfg.has("id")) {
                    v.setTextViewText(id(c, "w_title"), "Vélhop ou P+R");
                    v.setTextViewText(id(c, "w_big"), "—");
                    v.setTextViewText(id(c, "w_sub"), "Touchez pour choisir");
                    v.setOnClickPendingIntent(id(c, "w_root"), open(c, widgetId, 0, "config:" + widgetId + ":poi"));
                    return v;
                }
                boolean bike = cfg.optString("id").startsWith("velhop");
                int col = bike ? 0xFF86B80B : 0xFF1B6EC2;
                v.setImageViewBitmap(id(c, "w_badge"), chip(c, bike ? "Vélhop" : "P+R", col, Color.WHITE, 22));
                v.setTextViewText(id(c, "w_title"), cfg.optString("name").replaceFirst("^P\\+R ", ""));
                v.setOnClickPendingIntent(id(c, "w_root"), open(c, widgetId, 0, "poi:" + cfg.optString("id")));
                try {
                    JSONObject j = get(c, "/api/widget/poi?id=" + enc(cfg.optString("id")));
                    int track = c.getResources().getColor(res(c, "color", "w_line"), null);
                    if (bike) {
                        int a = j.optInt("velos", -1), p = j.optInt("places", -1);
                        v.setTextViewText(id(c, "w_big"), a >= 0 ? a + (a > 1 ? " vélos" : " vélo") : "—");
                        v.setTextViewText(id(c, "w_sub"), (p >= 0 ? p + (p > 1 ? " places libres" : " place libre") : "") + " · " + hm(System.currentTimeMillis()));
                        if (a >= 0 && p >= 0) v.setImageViewBitmap(id(c, "w_bar"), bar(c, a / (float) Math.max(1, a + p), col, track, 120));
                    } else {
                        boolean live = !j.isNull("libres");
                        int l = j.optInt("libres", -1), t = j.optInt("total", -1);
                        v.setTextViewText(id(c, "w_big"), live ? l + " places" : (t > 0 ? t + " places" : "—"));
                        v.setTextViewText(id(c, "w_sub"), live ? "libres sur " + t + " · " + hm(System.currentTimeMillis()) : "capacité (places libres indisponibles)");
                        if (live && t > 0) v.setImageViewBitmap(id(c, "w_bar"), bar(c, l / (float) t, col, track, 120));
                    }
                } catch (Exception e) {
                    v.setTextViewText(id(c, "w_big"), "—");
                    v.setTextViewText(id(c, "w_sub"), e.getMessage() != null ? e.getMessage() : "Serveur injoignable");
                }
                return v;
            }
            default: {   // raccourcis
                RemoteViews v = new RemoteViews(pkg, res(c, "layout", "w_shortcuts"));
                String[] targets = { "carte", "search", "favs", "msgs" };
                for (int i = 0; i < targets.length; i++) v.setOnClickPendingIntent(id(c, "w_sc" + i), open(c, widgetId, i, targets[i]));
                return v;
            }
        }
    }

    static RemoteViews message(Context c, RemoteViews v, String text) {
        for (int r = 0; r < 4; r++) v.setViewVisibility(id(c, "row" + r), View.GONE);
        v.setViewVisibility(id(c, "w_msg"), View.VISIBLE);
        v.setTextViewText(id(c, "w_msg"), text);
        return v;
    }

    static RemoteViews unconfigured(Context c, RemoteViews v, int widgetId, String type, String text) {
        v.setTextViewText(id(c, "w_title"), "Kumm");
        v.setTextViewText(id(c, "w_sub"), "");
        v.setOnClickPendingIntent(id(c, "w_root"), open(c, widgetId, 0, "config:" + widgetId + ":" + type));
        return message(c, v, text);
    }
}
