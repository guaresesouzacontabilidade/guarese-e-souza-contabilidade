// Fotos e imagens dos cartões: reduz para no máximo 1200 px (JPEG) para caber e sincronizar rápido.
export async function compressImage(file, max = 1200, quality = 0.78) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, w, h);
    c.drawImage(img, 0, 0, w, h);
    let data = canvas.toDataURL('image/jpeg', quality);
    // Ainda grande? Mais uma rodada com qualidade menor.
    if (data.length > 600_000) data = canvas.toDataURL('image/jpeg', 0.6);
    return { data, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
