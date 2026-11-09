// Recursos do app nativo (Android/iOS via Capacitor). No navegador, tudo aqui é ignorado.

export const isNative = () => globalThis.Capacitor?.isNativePlatform?.() === true;

const cache = {};

// Acesso aos plugins nativos pela ponte do Capacitor (sem etapa de build).
export function plugin(name) {
  if (!isNative()) return null;
  const cap = globalThis.Capacitor;
  cache[name] ??= cap.Plugins?.[name] || cap.registerPlugin?.(name) || null;
  return cache[name];
}

// Cor dos ícones da barra de status de acordo com o tema do app.
export function setSystemBarsTheme(dark) {
  plugin('SystemBars')
    ?.setStyle({ style: dark ? 'DARK' : 'LIGHT' })
    .catch(() => {});
}

// No app nativo não há "download": grava o arquivo e abre o menu de compartilhar
// (salvar no Drive, enviar por WhatsApp/e-mail etc.).
export async function shareFile(filename, content) {
  const fs = plugin('Filesystem');
  const share = plugin('Share');
  const { uri } = await fs.writeFile({ path: filename, data: content, directory: 'CACHE', encoding: 'utf8' });
  await share.share({ title: filename, files: [uri], dialogTitle: 'Salvar ou enviar' });
}
