/* Monta o site publicado pela Cloudflare em dist/ (o wrangler roda isto sozinho antes do deploy e do dev):
   1. copia public/;
   2. minifica CSS e JS (esbuild);
   3. acrescenta ?v=<impressão digital do conteúdo> nas referências a CSS e JS dentro do HTML;
   4. troca os links internos "pagina.html" pelo endereço final "pagina" (a Cloudflare responde
      "pagina.html" com um redirecionamento, que custaria uma ida e volta a mais em cada clique).
   Com o endereço mudando a cada alteração, CSS e JS podem ficar guardados no navegador por 1 ano
   (public/_headers), sem o navegador perguntar ao servidor a cada visita. O HTML continua sempre atualizado. */
import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve, relative, sep, extname } from "node:path";
import { transformSync } from "esbuild";

const ORIGEM = "public";
const SAIDA = "dist";

const arquivos = (pasta) =>
  readdirSync(pasta).flatMap((n) => {
    const p = join(pasta, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });

rmSync(SAIDA, { recursive: true, force: true });
cpSync(ORIGEM, SAIDA, { recursive: true });

// "agendamento.html" -> "agendamento"; "index.html" -> "./"; "../index.html#local" -> "../#local".
const enderecoFinal = (caminho, ancora = "") => {
  const semExtensao = caminho.replace(/\.html$/, "");
  const final = semExtensao === "index" ? "./" : semExtensao.endsWith("/index") ? semExtensao.slice(0, -5) : semExtensao;
  return final + ancora;
};
let links = 0;
for (const arquivo of arquivos(SAIDA)) {
  if (arquivo.endsWith(".html")) {
    const html = readFileSync(arquivo, "utf8").replace(/href="((?:\.\.\/)*[\w-]+(?:\/[\w-]+)*\.html)(#[^"]*)?"/g, (_, caminho, ancora) => {
      links += 1;
      return `href="${enderecoFinal(caminho, ancora)}"`;
    });
    writeFileSync(arquivo, html);
  } else if (arquivo.endsWith(".js") && !arquivo.endsWith("api-demo.js")) {
    // Navegação feita pelos scripts: location.replace("painel.html") e afins.
    const js = readFileSync(arquivo, "utf8").replace(/(location\.(?:replace|assign)\()(["'])((?:\.\.\/)*[\w-]+\.html)\2/g, (_, chamada, aspas, caminho) => {
      links += 1;
      return `${chamada}${aspas}${enderecoFinal(caminho)}${aspas}`;
    });
    writeFileSync(arquivo, js);
  }
}

// Minificação. Sem `format`, o esbuild não renomeia nomes globais (os scripts das páginas compartilham funções).
const impressoes = new Map(); // caminho relativo a dist (com "/") -> impressão digital
let antes = 0;
let depois = 0;
for (const arquivo of arquivos(SAIDA)) {
  const tipo = extname(arquivo);
  if (tipo !== ".css" && tipo !== ".js") continue;
  const codigo = readFileSync(arquivo, "utf8");
  const { code } = transformSync(codigo, {
    loader: tipo.slice(1),
    minify: true,
    target: tipo === ".css" ? ["safari15", "chrome100", "firefox100"] : "es2020",
    legalComments: "none",
  });
  writeFileSync(arquivo, code);
  antes += Buffer.byteLength(codigo);
  depois += Buffer.byteLength(code);
  const chave = relative(SAIDA, arquivo).split(sep).join("/");
  impressoes.set(chave, createHash("sha256").update(code).digest("hex").slice(0, 10));
}

// Versão nas referências do HTML: href="../css/painel.css" -> href="../css/painel.css?v=1a2b3c4d5e"
let trocas = 0;
for (const pagina of arquivos(SAIDA).filter((a) => a.endsWith(".html"))) {
  const html = readFileSync(pagina, "utf8").replace(/(href|src)="([^"?#:]+\.(?:css|js))"/g, (inteiro, atributo, ref) => {
    const alvo = ref.startsWith("/") ? join(SAIDA, ref) : resolve(dirname(pagina), ref);
    const chave = relative(resolve(SAIDA), resolve(alvo)).split(sep).join("/");
    const impressao = impressoes.get(chave);
    if (!impressao) return inteiro;
    trocas += 1;
    return `${atributo}="${ref}?v=${impressao}"`;
  });
  writeFileSync(pagina, html);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `Site montado em ${SAIDA}/: CSS e JS de ${kb(antes)} para ${kb(depois)}, ${trocas} referências versionadas, ${links} links diretos.`
);
