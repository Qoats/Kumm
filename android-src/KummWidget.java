package fr.kumm.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * Base des widgets Kumm : la mise à jour télécharge les données hors du fil principal (goAsync), puis dessine chaque widget.
 * Chaque type de widget est une petite sous-classe (StopWidget, TripWidget…) qui indique seulement son type.
 */
public abstract class KummWidget extends AppWidgetProvider {
    protected abstract String type();

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        final PendingResult done = goAsync();
        final Context c = context.getApplicationContext();
        final Class<?> self = getClass();
        new Thread(() -> {
            try {
                for (int id : ids) {
                    RemoteViews v = WidgetCore.build(c, type(), id, self);
                    if (v != null) manager.updateAppWidget(id, v);
                }
            } catch (Exception ignored) { /* un widget en erreur garde son dernier affichage */ }
            finally { done.finish(); }
        }).start();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (WidgetCore.ACTION_REFRESH.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (id != AppWidgetManager.INVALID_APPWIDGET_ID) onUpdate(context, AppWidgetManager.getInstance(context), new int[] { id });
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        android.content.SharedPreferences.Editor e = WidgetCore.prefs(context).edit();
        for (int id : ids) e.remove("w" + id);
        e.apply();
    }
}
