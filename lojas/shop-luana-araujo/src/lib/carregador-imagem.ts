"use client";

/**
 * Fotos dos produtos: o portal guarda cada foto em dois tamanhos já prontos
 * (WebP, 600 e 1200 px de largura). O site só escolhe o tamanho certo — sem
 * serviço de otimização de imagens cobrado à parte.
 */
export default function carregadorImagem({ src, width }: { src: string; width: number }) {
  return `${src}-${width <= 600 ? "p" : "g"}.webp`;
}
