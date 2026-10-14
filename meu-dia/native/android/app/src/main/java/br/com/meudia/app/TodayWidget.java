package br.com.meudia.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** Widget "Hoje": compromissos e tarefas do dia, saldo do mês e próxima conta. */
public class TodayWidget extends AppWidgetProvider {

    static final String PREFS = "meudia_widget";
    static final String KEY = "data";

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayWidget.class));
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    private static PendingIntent open(Context context, String route, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (route != null) intent.putExtra(MeuDiaPlugin.EXTRA_ROUTE, route);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        int[] rows = {R.id.w_item1, R.id.w_item2, R.id.w_item3};
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);

        for (int row : rows) views.setViewVisibility(row, View.GONE);
        views.setViewVisibility(R.id.w_more, View.GONE);
        views.setViewVisibility(R.id.w_bill, View.GONE);

        try {
            if (raw == null || raw.isEmpty()) throw new IllegalStateException("sem dados");
            JSONObject data = new JSONObject(raw);
            JSONObject labels = data.optJSONObject("dayLabels");
            views.setTextViewText(R.id.w_date, labels != null ? labels.optString(today, "Hoje") : "Hoje");
            JSONObject days = data.optJSONObject("days");
            JSONArray items = days != null ? days.optJSONArray(today) : null;
            if (items == null || items.length() == 0) {
                views.setTextViewText(R.id.w_item1, "Nada marcado para hoje");
                views.setViewVisibility(R.id.w_item1, View.VISIBLE);
            } else {
                for (int i = 0; i < rows.length && i < items.length(); i++) {
                    views.setTextViewText(rows[i], items.getString(i));
                    views.setViewVisibility(rows[i], View.VISIBLE);
                }
                if (items.length() > rows.length) {
                    views.setTextViewText(R.id.w_more, "+ " + (items.length() - rows.length) + " na agenda");
                    views.setViewVisibility(R.id.w_more, View.VISIBLE);
                }
            }
            views.setTextViewText(R.id.w_balance_label, data.optString("balanceLabel", "Saldo do mês"));
            views.setTextViewText(R.id.w_balance, data.optString("balance", ""));
            String bill = data.optString("bill", "");
            if (!bill.isEmpty()) {
                views.setTextViewText(R.id.w_bill, bill);
                views.setViewVisibility(R.id.w_bill, View.VISIBLE);
            }
        } catch (Exception e) {
            views.setTextViewText(R.id.w_date, "Meu Dia");
            views.setTextViewText(R.id.w_item1, "Abra o Meu Dia para ver seu dia aqui.");
            views.setViewVisibility(R.id.w_item1, View.VISIBLE);
            views.setTextViewText(R.id.w_balance_label, "");
            views.setTextViewText(R.id.w_balance, "");
        }

        views.setOnClickPendingIntent(R.id.w_root, open(context, null, 100));
        views.setOnClickPendingIntent(R.id.w_add_expense, open(context, "add:expense", 101));
        views.setOnClickPendingIntent(R.id.w_add_event, open(context, "add:event", 102));
        return views;
    }
}
