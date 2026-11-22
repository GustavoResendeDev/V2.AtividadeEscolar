/* Servidor local (Node): mesma API do Worker + os arquivos de public/, com o banco PGlite.
   Usado pelo npm start (dados na pasta dados/) e pelos testes (banco em memória). */
const fs = require("node:fs");
const path = require("node:path");
const { serve } = require("@hono/node-server");
const { serveStatic } = require("@hono/node-server/serve-static");
const { getConnInfo } = require("@hono/node-server/conninfo");
const { criarApp } = require("./app");

// SITE_DIR=dist serve o site montado (minificado e versionado), igual ao publicado; o padrão é public/.
const PASTA_PUBLICA = path.resolve(__dirname, "..", process.env.SITE_DIR || "public");

function arquivosEstaticos() {
  // Igual à Cloudflare: "/" e "/admin/" servem index.html; "/agendamento" serve agendamento.html.
  const servir = serveStatic({
    root: path.relative(process.cwd(), PASTA_PUBLICA) || ".",
    rewriteRequestPath(p) {
      if (p.endsWith("/")) return `${p}index.html`;
      if (!path.extname(p) && fs.existsSync(path.join(PASTA_PUBLICA, `${p}.html`))) return `${p}.html`;
      return p;
    },
    onFound(caminho, c) {
      if (/\.(webp|png|woff2|mp4)$/.test(caminho)) c.header("Cache-Control", "public, max-age=604800");
    },
  });
  // Arquivos de configuração da Cloudflare (_headers etc.) não são servidos, igual em produção.
  const bloqueado = (c) => /\/_[^/]*$/.test(c.req.path);
  return {
    servir: async (c, next) => (bloqueado(c) ? next() : servir(c, next)),
    pagina404: fs.readFileSync(path.join(PASTA_PUBLICA, "404.html"), "utf8"),
  };
}

function criarAppLocal(opcoes) {
  return criarApp({ estaticos: arquivosEstaticos(), ipDe: (c) => getConnInfo(c).remote.address, ...opcoes });
}

/* Sobe o servidor HTTP. porta 0 = porta livre qualquer (testes). */
function iniciar(app, porta) {
  return new Promise((ok) => {
    const servidor = serve({ fetch: app.fetch, port: porta, hostname: porta === 0 ? "127.0.0.1" : undefined }, (info) =>
      ok({ servidor, porta: info.port, fechar: () => new Promise((fim) => servidor.close(() => fim())) })
    );
  });
}

module.exports = { criarAppLocal, iniciar };
