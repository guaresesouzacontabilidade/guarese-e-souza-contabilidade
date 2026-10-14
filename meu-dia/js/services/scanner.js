// Leitura do código de barras do boleto pela câmera (Google ML Kit, no próprio celular).
import { isNative, plugin } from './native.js';

export const scannerAvailable = () => isNative() && Boolean(plugin('BarcodeScanner'));

export async function scanBoleto() {
  const bs = plugin('BarcodeScanner');
  const { available } = await bs.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await bs.installGoogleBarcodeScannerModule().catch(() => {});
    throw new Error('Preparando o leitor de código de barras… tente de novo em alguns segundos.');
  }
  const { barcodes } = await bs.scan({ formats: ['ITF'] });
  return barcodes?.[0]?.rawValue || barcodes?.[0]?.displayValue || null;
}

// Copia texto (ex.: código do boleto para colar no app do banco).
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
