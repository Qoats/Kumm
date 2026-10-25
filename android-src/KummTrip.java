package fr.kumm.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

/**
 * Lien entre l'application et le trajet suivi (TripService) :
 * - start : démarre le suivi (course, arrêts, arrêt de montée et de descente) ; demande d'abord l'autorisation d'afficher
 *   des notifications (Android 13 et plus) ;
 * - stop : arrête le suivi ;
 * - status : où en est le trajet (arrêts restants, prochain arrêt…), pour le bandeau de l'application.
 */
@CapacitorPlugin(name = "KummTrip", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class KummTrip extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterNotifications");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) { launch(call); }

    private void launch(PluginCall call) {
        Intent i = new Intent(getContext(), TripService.class).setAction(TripService.ACTION_START)
            .putExtra(TripService.EXTRA_TRIP, call.getData().toString());
        try { ContextCompat.startForegroundService(getContext(), i); }
        catch (Exception e) { call.reject("Suivi du trajet impossible : " + e.getMessage()); return; }
        JSObject r = new JSObject();
        r.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().startService(new Intent(getContext(), TripService.class).setAction(TripService.ACTION_STOP));
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSONObject s = TripService.status;
        try { call.resolve(s != null ? JSObject.fromJSONObject(s) : new JSObject().put("active", false)); }
        catch (Exception e) { call.resolve(new JSObject().put("active", false)); }
    }
}
