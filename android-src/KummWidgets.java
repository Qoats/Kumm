package fr.kumm.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/**
 * Lien entre l'application et les widgets de l'écran d'accueil (WidgetCore) :
 * - sync : l'application transmet ses données (serveur, couleurs des lignes, lignes suivies, dernière position) ;
 * - configure : choix d'un widget (arrêt, trajet, station), fait dans l'application ;
 * - pending / événement « open » : un widget a été touché, l'application s'ouvre sur l'écran demandé.
 */
@CapacitorPlugin(name = "KummWidgets")
public class KummWidgets extends Plugin {
    private String take(Intent i) {
        if (i == null || !i.hasExtra(WidgetCore.EXTRA_OPEN)) return null;
        String v = i.getStringExtra(WidgetCore.EXTRA_OPEN);
        i.removeExtra(WidgetCore.EXTRA_OPEN);   // traité une seule fois (pas à chaque retour dans l'application)
        return v;
    }

    @PluginMethod
    public void sync(PluginCall call) {
        JSObject d = call.getData();
        WidgetCore.prefs(getContext()).edit().putString("sync", d.toString()).apply();
        if (call.getBoolean("refresh", true)) WidgetCore.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        Integer id = call.getInt("widgetId");
        JSObject cfg = call.getObject("config");
        if (id == null || cfg == null) { call.reject("widgetId et config sont nécessaires"); return; }
        WidgetCore.prefs(getContext()).edit().putString("w" + id, cfg.toString()).apply();
        WidgetCore.refreshOne(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        WidgetCore.refreshAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void pending(PluginCall call) {
        JSObject r = new JSObject();
        String v = take(getActivity() != null ? getActivity().getIntent() : null);
        if (v != null) r.put("open", v);
        call.resolve(r);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String v = take(intent);
        if (v == null) return;
        JSObject r = new JSObject();
        r.put("open", v);
        notifyListeners("open", r, true);
    }
}
