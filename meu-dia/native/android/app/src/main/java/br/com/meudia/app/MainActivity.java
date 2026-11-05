package br.com.meudia.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin próprio do Meu Dia (widget, atalhos do ícone, privacidade).
        registerPlugin(MeuDiaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
