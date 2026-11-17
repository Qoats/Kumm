package fr.kumm.app;
import android.app.job.JobParameters;
import android.app.job.JobService;
/** Android chooses the execution time according to network, battery and background restrictions. */
public class GtfsJob extends JobService {
    private Thread task;
    @Override public boolean onStartJob(JobParameters parameters) {
        task = new Thread(() -> {
            try { KummGtfs.synchronize(getApplicationContext(), false); }
            catch (Exception ignored) { /* Last valid local schedules remain available. */ }
            jobFinished(parameters, false);
        }, "kumm-gtfs-periodic"); task.start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters parameters) { if (task != null) task.interrupt(); return true; }
}
