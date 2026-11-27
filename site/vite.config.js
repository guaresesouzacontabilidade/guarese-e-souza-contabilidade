// Site ON Guarese's Contabilidade com Vite: três páginas (início, privacidade e 404).
// Arquivos com endereço fixo (imagens, fontes, manifesto, robots e sitemap) ficam em public/;
// o CSS e o JavaScript são empacotados e minificados em /assets com o nome versionado.
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const pagina = (arquivo) => fileURLToPath(new URL(arquivo, import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Uma página com um único script: o polyfill de modulepreload não é necessário
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        inicio: pagina("./index.html"),
        privacidade: pagina("./privacidade.html"),
        naoEncontrada: pagina("./404.html"),
      },
    },
  },
});
