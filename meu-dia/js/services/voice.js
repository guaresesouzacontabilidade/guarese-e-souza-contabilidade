// Reconhecimento de voz: plugin nativo no Android; Web Speech API onde o navegador oferece.
import { isNative, plugin } from './native.js';

const WebSR = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export const voiceAvailable = () => (isNative() ? Boolean(plugin('SpeechRecognition')) : Boolean(WebSR()));

// Ouve uma frase e devolve o texto reconhecido (ou null se a pessoa cancelar).
export async function listen(prompt = 'Fale agora') {
  if (isNative()) {
    const sr = plugin('SpeechRecognition');
    const { available } = await sr.available();
    if (!available) throw new Error('O reconhecimento de voz não está disponível neste celular.');
    const perm = await sr.requestPermissions();
    if (perm?.speechRecognition && perm.speechRecognition !== 'granted') throw new Error('Permita o uso do microfone para falar com o app.');
    const res = await sr.start({ language: 'pt-BR', maxResults: 3, prompt, partialResults: false, popup: true });
    return res?.matches?.[0] || null;
  }
  const SR = WebSR();
  if (!SR) throw new Error('Este navegador não reconhece voz.');
  return new Promise((resolve, reject) => {
    const rec = new SR();
    rec.lang = 'pt-BR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let text = null;
    rec.onresult = (e) => {
      text = e.results?.[0]?.[0]?.transcript || null;
    };
    rec.onerror = (e) => (e.error === 'no-speech' || e.error === 'aborted' ? resolve(null) : reject(new Error('Não consegui ouvir. Tente de novo.')));
    rec.onend = () => resolve(text);
    rec.start();
  });
}
