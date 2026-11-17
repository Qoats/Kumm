package fr.kumm.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.zip.ZipFile;

/** SQLite timetable used by home-screen widgets while the WebView is closed. */
final class LocalTimetable {
    private static final Object LOCK = new Object();
    private static SQLiteDatabase open(Context c) { return open(c, c.getSharedPreferences("official-gtfs",Context.MODE_PRIVATE).getString("database","gtfs-widgets.db")); }
    private static SQLiteDatabase open(Context c, String name) {
        SQLiteDatabase db = c.openOrCreateDatabase(name, Context.MODE_PRIVATE, null);
        db.execSQL("CREATE TABLE IF NOT EXISTS stops(src TEXT,id TEXT,code TEXT,parent TEXT,name TEXT,lat REAL,lon REAL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS routes(src TEXT,id TEXT,line TEXT)");
        db.execSQL("CREATE TABLE IF NOT EXISTS trips(src TEXT,id TEXT,route TEXT,service TEXT,dest TEXT)");
        db.execSQL("CREATE TABLE IF NOT EXISTS services(src TEXT,id TEXT,start TEXT,end TEXT,days INTEGER)");
        db.execSQL("CREATE TABLE IF NOT EXISTS exceptions(src TEXT,id TEXT,date TEXT,kind INTEGER)");
        db.execSQL("CREATE TABLE IF NOT EXISTS calls(src TEXT,trip TEXT,stop TEXT,seq INTEGER,arr INTEGER,dep INTEGER,board INTEGER)");
        db.execSQL("CREATE INDEX IF NOT EXISTS calls_stop ON calls(src,stop,dep)");
        db.execSQL("CREATE INDEX IF NOT EXISTS calls_trip ON calls(src,trip,seq)");
        db.execSQL("CREATE INDEX IF NOT EXISTS trips_id ON trips(src,id)");
        db.execSQL("CREATE INDEX IF NOT EXISTS routes_id ON routes(src,id)");
        db.execSQL("CREATE INDEX IF NOT EXISTS services_id ON services(src,id)");
        db.execSQL("CREATE INDEX IF NOT EXISTS exceptions_id ON exceptions(src,id,date)");
        db.execSQL("CREATE INDEX IF NOT EXISTS stops_id ON stops(src,id)");
        return db;
    }
    private interface Row { void accept(Map<String,String> r) throws Exception; }
    private static String[] csv(String text) {
        List<String> fields = new ArrayList<>(); StringBuilder field = new StringBuilder(); boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == '"') { if (quoted && i + 1 < text.length() && text.charAt(i + 1) == '"') { field.append('"'); i++; } else quoted = !quoted; }
            else if (ch == ',' && !quoted) { fields.add(field.toString()); field.setLength(0); } else field.append(ch);
        }
        fields.add(field.toString()); return fields.toArray(new String[0]);
    }
    private static void rows(ZipFile zip, String file, boolean optional, Row fn) throws Exception {
        if (zip.getEntry(file) == null) { if (optional) return; throw new IOException(file + " absent"); }
        try (BufferedReader r = new BufferedReader(new InputStreamReader(zip.getInputStream(zip.getEntry(file)), "UTF-8"))) {
            String head = r.readLine(); if (head == null) throw new IOException("GTFS vide : " + file);
            String[] names = csv(head.replace("\uFEFF", "")); String line;
            while ((line = r.readLine()) != null) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Import GTFS interrompu");
                if (line.isEmpty()) continue;
                String[] fields = csv(line); Map<String,String> m = new HashMap<>();
                for (int i = 0; i < names.length; i++) m.put(names[i], i < fields.length ? fields[i] : "");
                fn.accept(m);
            }
        }
    }
    private static String v(Map<String,String> r, String key) { return r.getOrDefault(key, ""); }
    private static int seconds(String value) {
        if (!value.matches("\\d{1,3}:[0-5]\\d:[0-5]\\d")) return -1;
        String[] parts = value.split(":"); return Integer.parseInt(parts[0]) * 3600 + Integer.parseInt(parts[1]) * 60 + Integer.parseInt(parts[2]);
    }
    private static void insert(SQLiteStatement s, Object... values) {
        s.clearBindings();
        for (int i = 0; i < values.length; i++) s.bindString(i + 1, String.valueOf(values[i]));
        s.executeInsert();
    }
    static void prepare(Context c, String src, File archive, String name) throws Exception {
        synchronized (LOCK) {
            String current = c.getSharedPreferences("official-gtfs",Context.MODE_PRIVATE).getString("database","gtfs-widgets.db");
            File previous = c.getDatabasePath(current), next = c.getDatabasePath(name);
            if (previous.isFile()) {
                next.getParentFile().mkdirs();
                try (InputStream in = new FileInputStream(previous); FileOutputStream out = new FileOutputStream(next)) {
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = in.read(buffer)) != -1) out.write(buffer,0,count);
                    out.getFD().sync();
                }
            }
            replace(c,src,archive,name);
        }
    }
    static void replace(Context c, String src, File archive) throws Exception {
        replace(c,src,archive,c.getSharedPreferences("official-gtfs",Context.MODE_PRIVATE).getString("database","gtfs-widgets.db"));
    }
    private static void replace(Context c, String src, File archive, String database) throws Exception {
        synchronized (LOCK) {
            try (SQLiteDatabase db = open(c,database); ZipFile zip = new ZipFile(archive)) {
                db.beginTransaction();
                try {
                    for (String table : new String[]{"stops","routes","trips","services","exceptions","calls"}) db.delete(table,"src=?",new String[]{src});
                    try (SQLiteStatement s = db.compileStatement("INSERT INTO stops VALUES(?,?,?,?,?,?,?)")) {
                        rows(zip,"stops.txt",false,r -> { if (!src.equals("ter") || v(r,"stop_id").startsWith("StopPoint:OCETrain TER-")) insert(s,src,v(r,"stop_id"),v(r,"stop_code"),(v(r,"parent_station").isEmpty() ? v(r,"stop_id").replaceFirst("_\\d+$", "") : v(r,"parent_station")),v(r,"stop_name"),v(r,"stop_lat"),v(r,"stop_lon")); });
                    }
                    try (SQLiteStatement s = db.compileStatement("INSERT INTO routes VALUES(?,?,?)")) {
                        rows(zip,"routes.txt",false,r -> insert(s,src,v(r,"route_id"),src.equals("ter") ? "TER" : v(r,"route_short_name")));
                    }
                    try (SQLiteStatement s = db.compileStatement("INSERT INTO trips VALUES(?,?,?,?,?)")) {
                        rows(zip,"trips.txt",false,r -> insert(s,src,v(r,"trip_id"),v(r,"route_id"),v(r,"service_id"),v(r,"trip_headsign")));
                    }
                    try (SQLiteStatement s = db.compileStatement("INSERT INTO services VALUES(?,?,?,?,?)")) {
                        rows(zip,"calendar.txt",true,r -> {
                            int mask = 0, i = 0;
                            for (String day : new String[]{"monday","tuesday","wednesday","thursday","friday","saturday","sunday"}) { if (v(r,day).equals("1")) mask |= 1 << i; i++; }
                            insert(s,src,v(r,"service_id"),v(r,"start_date"),v(r,"end_date"),mask);
                        });
                    }
                    try (SQLiteStatement s = db.compileStatement("INSERT INTO exceptions VALUES(?,?,?,?)")) {
                        rows(zip,"calendar_dates.txt",true,r -> insert(s,src,v(r,"service_id"),v(r,"date"),v(r,"exception_type")));
                    }
                    try (SQLiteStatement s = db.compileStatement("INSERT INTO calls VALUES(?,?,?,?,?,?,?)")) {
                        rows(zip,"stop_times.txt",false,r -> {
                            if (src.equals("ter") && !v(r,"stop_id").startsWith("StopPoint:OCETrain TER-")) return;
                            int dep = seconds(v(r,"departure_time")), arr = seconds(v(r,"arrival_time"));
                            if (dep < 0) dep = arr; if (arr < 0) arr = dep;
                            if (dep >= 0) insert(s,src,v(r,"trip_id"),v(r,"stop_id"),v(r,"stop_sequence"),arr,dep,v(r,"pickup_type").equals("1") ? 0 : 1);
                        });
                    }
                    String usable = "SELECT 1 FROM calls JOIN stops ON stops.src=calls.src AND stops.id=calls.stop JOIN trips ON trips.src=calls.src AND trips.id=calls.trip JOIN routes ON routes.src=trips.src AND routes.id=trips.route WHERE calls.src=? AND calls.board=1 AND (EXISTS(SELECT 1 FROM services WHERE src=trips.src AND id=trips.service) OR EXISTS(SELECT 1 FROM exceptions WHERE src=trips.src AND id=trips.service)) AND EXISTS(SELECT 1 FROM calls last JOIN stops terminal ON terminal.src=last.src AND terminal.id=last.stop WHERE last.src=calls.src AND last.trip=calls.trip AND last.seq>calls.seq) LIMIT 1";
                    try (Cursor count = db.rawQuery(usable,new String[]{src})) {
                        if (!count.moveToFirst()) throw new IOException("GTFS sans horaires exploitables");
                    }
                    if (src.equals("ter")) db.execSQL("UPDATE trips SET dest=COALESCE((SELECT stops.name FROM calls JOIN stops ON stops.src=calls.src AND stops.id=calls.stop WHERE calls.src=trips.src AND calls.trip=trips.id ORDER BY calls.seq DESC LIMIT 1),dest) WHERE src='ter'");
                    db.setTransactionSuccessful();
                } finally { db.endTransaction(); }
            }
        }
    }
    static JSONObject widget(Context c, String path) throws Exception { return widget(c,path,System.currentTimeMillis()); }
    static JSONObject widget(Context c, String path, long now) throws Exception {
        synchronized (LOCK) {
            Uri u = Uri.parse("https://localhost" + path);
            if (!u.getPath().equals("/api/widget/stop") && !u.getPath().equals("/api/widget/nearby")) throw new IOException("Bientôt disponible");
            try (SQLiteDatabase db = open(c)) {
                List<String[]> stops = new ArrayList<>(); JSONObject result = new JSONObject();
                if (u.getPath().endsWith("nearby")) {
                    double lat = Double.parseDouble(u.getQueryParameter("lat")), lon = Double.parseDouble(u.getQueryParameter("lon")), best = 3500;
                    String[] chosen = null;
                    try (Cursor r = db.rawQuery("SELECT src,id,name,lat,lon FROM stops WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", new String[]{""+(lat-.04),""+(lat+.04),""+(lon-.06),""+(lon+.06)})) {
                        while (r.moveToNext()) {
                            double d = Math.hypot((r.getDouble(3)-lat)*110540,(r.getDouble(4)-lon)*111320*Math.cos(lat*Math.PI/180));
                            if (d < best) { best = d; chosen = new String[]{r.getString(0),r.getString(1)}; result.put("name",r.getString(2)); }
                        }
                    }
                    if (chosen != null) stops.add(chosen); result.put("dist",Math.round(best));
                } else {
                    Set<String> refs = new HashSet<>(Arrays.asList(Optional.ofNullable(u.getQueryParameter("refs")).orElse("").split(",")));
                    String sncf = Optional.ofNullable(u.getQueryParameter("sncf")).orElse("");
                    try (Cursor r = db.rawQuery("SELECT src,id,code,parent FROM stops", null)) {
                        while (r.moveToNext()) if (refs.contains(r.getString(1)) || refs.contains(r.getString(2)) || refs.contains(r.getString(3)) || !sncf.isEmpty() && r.getString(0).equals("ter") && r.getString(1).contains(sncf)) stops.add(new String[]{r.getString(0),r.getString(1)});
                    }
                }
                LocalDate today = Instant.ofEpochMilli(now).atZone(ZoneId.of("Europe/Paris")).toLocalDate();
                Map<String,JSONObject> groups = new LinkedHashMap<>(); List<JSONObject> visits = new ArrayList<>();
                int lookback = 1;
                try (Cursor r = db.rawQuery("SELECT MAX(dep)/86400 FROM calls", null)) { if (r.moveToFirst()) lookback = Math.max(1,r.getInt(0)); }
                for (int offset = -lookback; offset <= 1; offset++) {
                    LocalDate date = today.plusDays(offset); String day = date.format(DateTimeFormatter.BASIC_ISO_DATE);
                    long base = date.atTime(12,0).atZone(ZoneId.of("Europe/Paris")).toInstant().toEpochMilli()-43200000;
                    String bit = ""+(1 << (date.getDayOfWeek().getValue()-1));
                    for (String[] stop : stops) {
                        String sql = "SELECT routes.line,trips.dest,calls.dep FROM calls JOIN stops ON stops.src=calls.src AND stops.id=calls.stop JOIN trips ON trips.src=calls.src AND trips.id=calls.trip JOIN routes ON routes.src=trips.src AND routes.id=trips.route WHERE calls.src=? AND calls.stop=? AND calls.board=1 AND calls.dep>=? AND calls.dep<? AND EXISTS(SELECT 1 FROM calls last WHERE last.src=calls.src AND last.trip=calls.trip AND last.seq>calls.seq) AND (COALESCE((SELECT kind=1 FROM exceptions WHERE src=trips.src AND id=trips.service AND date=? LIMIT 1),(SELECT start<=? AND end>=? AND (days & ?)<>0 FROM services WHERE src=trips.src AND id=trips.service LIMIT 1),0)) ORDER BY calls.dep LIMIT 80";
                        try (Cursor r = db.rawQuery(sql,new String[]{stop[0],stop[1],""+Math.ceil((now-base)/1000.0),""+((now+86400000-base)/1000),day,day,day,bit})) {
                            while (r.moveToNext()) visits.add(new JSONObject().put("l",r.getString(0)).put("d",r.getString(1)).put("time",base+r.getLong(2)*1000));
                        }
                    }
                }
                visits.sort(Comparator.comparingLong(v -> v.optLong("time")));
                Set<String> filter = new HashSet<>(Arrays.asList(Optional.ofNullable(u.getQueryParameter("only")).orElse("").split("~")));
                for (JSONObject visit : visits) {
                    String key = visit.getString("l")+"|"+visit.getString("d");
                    if (!filter.contains("") && !filter.contains(key)) continue;
                    JSONObject g = groups.get(key);
                    if (g == null) { g = new JSONObject().put("l",visit.getString("l")).put("d",visit.getString("d")).put("rt",false).put("t",new JSONArray()); groups.put(key,g); }
                    JSONArray times = g.getJSONArray("t"); long time = visit.getLong("time");
                    if (times.length() < 4 && (times.length()==0 || times.optLong(times.length()-1)!=time)) times.put(time);
                }
                return result.put("scheduled",true).put("deps",new JSONArray(groups.values()));
            }
        }
    }
}
