// Gera o app Android nativo (Capacitor) com nome, ícones, tela de abertura e
// ícone de notificação do Meu Dia.
//
//   npm run android          prepara/atualiza o projeto em android/
//   npm run android:apk      prepara e gera o APK em dist-android/
//
// Para gerar o APK é preciso Java 21 e o Android SDK (ANDROID_HOME). Se as variáveis
// MEUDIA_KEYSTORE, MEUDIA_KEYSTORE_PASSWORD, MEUDIA_KEY_ALIAS e MEUDIA_KEY_PASSWORD
// existirem, o APK sai assinado com essa chave (necessário para instalar atualizações
// por cima sem desinstalar); senão, sai com a chave de depuração.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(root, 'android');
const res = path.join(android, 'app/src/main/res');
const build = process.argv.includes('--build');

const BG = '#060912';
const ICON_BG = '#0e1630';

const run = (cmd, cwd = root) => execSync(cmd, { stdio: 'inherit', cwd, env: process.env });

// ---------- Projeto ----------

run('node scripts/build-native.mjs');
if (!existsSync(android)) run('npx cap add android');
run('npx cap sync android');

// Versão do app a partir do package.json (1.2.3 → versionCode 10203).
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const gradleFile = path.join(android, 'app/build.gradle');
let gradle = await readFile(gradleFile, 'utf8');
gradle = gradle
  .replace(/versionCode \d+/, `versionCode ${maj * 10000 + min * 100 + pat}`)
  .replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`);
// Assinatura: lida de variáveis de ambiente, nunca gravada no projeto.
if (!gradle.includes("apply from: 'meudia-signing.gradle'")) gradle += "\napply from: 'meudia-signing.gradle'\n";
await writeFile(gradleFile, gradle);
await writeFile(
  path.join(android, 'app/meudia-signing.gradle'),
  `// Gerado por scripts/android.mjs: assina a versão final com a chave do Meu Dia, se informada.
def ks = System.getenv('MEUDIA_KEYSTORE')
if (ks) {
  android {
    signingConfigs {
      meudia {
        storeFile file(ks)
        storePassword System.getenv('MEUDIA_KEYSTORE_PASSWORD')
        keyAlias System.getenv('MEUDIA_KEY_ALIAS')
        keyPassword System.getenv('MEUDIA_KEY_PASSWORD') ?: System.getenv('MEUDIA_KEYSTORE_PASSWORD')
      }
    }
    buildTypes {
      release {
        signingConfig signingConfigs.meudia
      }
    }
  }
}
`,
);

await writeFile(
  path.join(res, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ICON_BG}</color>\n    <color name="meudia_background">${BG}</color>\n</resources>\n`,
);

// Tela de abertura escura (Android 12+ usa a API de splash; versões antigas, a imagem).
await writeFile(
  path.join(res, 'values/styles.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>

    <style name="AppTheme" parent="Theme.AppCompat.DayNight.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@color/meudia_background</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">@color/meudia_background</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>
`,
);

// ---------- Imagens ----------

const svg = await readFile(path.join(root, 'assets/icons/icon.svg'), 'utf8');
const art = svg.replace(/<rect[^>]*\/>/, '').replace(/<circle cx="256" cy="256" r="196"[^>]*\/>/, '');
// Arte centralizada dentro da zona segura do ícone adaptativo (66 de 108 dp).
const foreground = art.replace('viewBox="0 0 512 512"', 'viewBox="-14 -14 540 540"');
const fullBleed = svg.replace('rx="116"', 'rx="0"');
const white = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path d="M289.13 379.64 A128 128 0 1 1 379.64 289.13" fill="none" stroke="#fff" stroke-width="56" stroke-linecap="round"/>
  <circle cx="346.5" cy="346.5" r="34" fill="#fff"/>
  <path d="M206 258l34 34 68-72" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const dataUrl = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(file, width, height, body) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent">${body}</body></html>`);
  await page.waitForTimeout(30);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } }));
}

const img = (src, size, extra = '') => `<img src="${dataUrl(src)}" style="display:block;width:${size}px;height:${size}px;${extra}">`;

for (const [d, k] of Object.entries(DENSITIES)) {
  const launcher = Math.round(48 * k);
  const fg = Math.round(108 * k);
  await render(path.join(res, `mipmap-${d}/ic_launcher.png`), launcher, launcher, img(svg, launcher));
  await render(path.join(res, `mipmap-${d}/ic_launcher_round.png`), launcher, launcher, img(fullBleed, launcher, 'border-radius:50%'));
  await render(path.join(res, `mipmap-${d}/ic_launcher_foreground.png`), fg, fg, img(foreground, fg));
  const stat = Math.round(24 * k);
  await render(path.join(res, `drawable-${d}/ic_stat_meudia.png`), stat, stat, img(white, stat));
}

// Splash (versões antigas do Android): fundo escuro com o ícone no centro.
for (const dir of (await readdir(res)).filter((n) => n.startsWith('drawable'))) {
  const file = path.join(res, dir, 'splash.png');
  if (!existsSync(file)) continue;
  const head = await readFile(file);
  const w = head.readUInt32BE(16);
  const h = head.readUInt32BE(20);
  const size = Math.round(Math.min(w, h) * 0.3);
  await render(file, w, h, `<div style="width:${w}px;height:${h}px;background:${BG};display:grid;place-items:center">${img(svg, size, 'border-radius:22%')}</div>`);
}
await browser.close();
console.log('Projeto Android atualizado.');

// ---------- APK ----------

if (build) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk) await writeFile(path.join(android, 'local.properties'), `sdk.dir=${sdk}\n`);
  const ks = process.env.MEUDIA_KEYSTORE;
  const signed = ks && process.env.MEUDIA_KEYSTORE_PASSWORD && process.env.MEUDIA_KEY_ALIAS;
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  if (signed) {
    run(`${gradlew} assembleRelease --no-daemon`, android);
  } else {
    run(`${gradlew} assembleDebug --no-daemon`, android);
  }
  const out = path.join(android, `app/build/outputs/apk/${signed ? 'release/app-release.apk' : 'debug/app-debug.apk'}`);
  await mkdir(path.join(root, 'dist-android'), { recursive: true });
  const target = path.join(root, 'dist-android', `MeuDia-${pkg.version}${signed ? '' : '-debug'}.apk`);
  await copyFile(out, target);
  console.log(`APK pronto: ${path.relative(root, target)}`);
}
