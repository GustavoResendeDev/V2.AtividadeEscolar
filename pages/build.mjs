/* Monta a versão estática para o GitHub Pages em _site/:
   copia public/, inclui a API de demonstração (pages/api-demo.js) em todas as páginas
   e ajusta os caminhos absolutos da 404 para o endereço do projeto (/<repositorio>/). */
import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SAIDA = "_site";
const BASE = process.env.PAGES_BASE || "/"; // ex.: /V2.AtividadeEscolar/

rmSync(SAIDA, { recursive: true, force: true });
cpSync("public", SAIDA, { recursive: true });
cpSync("pages/api-demo.js", join(SAIDA, "js", "api-demo.js"));

const paginas = (pasta) =>
  readdirSync(pasta).flatMap((n) => {
    const p = join(pasta, n);
    return statSync(p).isDirectory() ? paginas(p) : p.endsWith(".html") ? [p] : [];
  });

for (const arquivo of paginas(SAIDA)) {
  let html = readFileSync(arquivo, "utf8");
  const nivel = relative(SAIDA, arquivo).split(sep).length - 1;
  const caminho = nivel ? "../".repeat(nivel) + "js/api-demo.js" : "./js/api-demo.js";
  if (arquivo.endsWith("404.html")) {
    // A 404 é servida em qualquer endereço: o <base> faz os caminhos relativos apontarem para o site.
    html = html.replace(/(href|src)="\/(?!\/)/g, `$1="${BASE}`);
    html = html.replace("<head>", `<head>\n    <base href="${BASE}" />\n    <script src="${BASE}js/api-demo.js"></script>`);
  } else {
    html = html.replace("<head>", `<head>\n    <script src="${caminho}"></script>`);
  }
  writeFileSync(arquivo, html);
}
writeFileSync(join(SAIDA, ".nojekyll"), "");
console.log("Site do Pages montado em _site/");
