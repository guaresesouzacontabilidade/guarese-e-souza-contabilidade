package br.com.meudia.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ponte entre o app (JavaScript) e recursos do Android:
 * - atualiza o widget "Hoje" com o resumo enviado pelo app;
 * - entrega ao app a tela pedida por um atalho do ícone ou botão do widget;
 * - esconde a miniatura do app na tela de apps recentes quando o bloqueio está ativo.
 */
@CapacitorPlugin(name = "MeuDia")
public class MeuDiaPlugin extends Plugin {

    static final String EXTRA_ROUTE = "meudia_route";
    private String pendingRoute;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity != null) pendingRoute = takeRoute(activity.getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String route = takeRoute(intent);
        if (route != null) {
            JSObject data = new JSObject();
            data.put("route", route);
            notifyListeners("route", data, true);
        }
    }

    private static String takeRoute(Intent intent) {
        if (intent == null) return null;
        String route = intent.getStringExtra(EXTRA_ROUTE);
        if (route != null) intent.removeExtra(EXTRA_ROUTE);
        return route;
    }

    @PluginMethod
    public void takeLaunchRoute(PluginCall call) {
        JSObject result = new JSObject();
        result.put("route", pendingRoute);
        pendingRoute = null;
        call.resolve(result);
    }

    @PluginMethod
    public void updateWidget(PluginCall call) {
        Context context = getContext();
        String data = call.getString("data", "");
        context.getSharedPreferences(TodayWidget.PREFS, Context.MODE_PRIVATE).edit().putString(TodayWidget.KEY, data).apply();
        TodayWidget.refreshAll(context);
        call.resolve();
    }

    @PluginMethod
    public void setPrivacy(PluginCall call) {
        boolean hide = Boolean.TRUE.equals(call.getBoolean("hideInRecents", false));
        Activity activity = getActivity();
        if (activity != null && Build.VERSION.SDK_INT >= 33) {
            activity.runOnUiThread(() -> activity.setRecentsScreenshotEnabled(!hide));
        }
        call.resolve();
    }
}
