/* Servidor local (Node): mesma API do Worker + os arquivos de public/, com o banco PGlite.
   Usado pelo npm start (dados na pasta dados/) e pelos testes (banco em memória). */
const fs = require("node:fs");
const path = require("node:path");
const { serve } = require("@hono/node-server");
const { serveStatic } = require("@hono/node-server/serve-static");
const { getConnInfo } = require("@hono/node-server/conninfo");
const { criarApp } = require("./app");

const PASTA_PUBLICA = path.join(__dirname, "..", "public");
const PASTA_RELATIVA = path.relative(process.cwd(), PASTA_PUBLICA) || ".";

function arquivosEstaticos() {
  const servir = serveStatic({
    root: PASTA_RELATIVA,
    rewriteRequestPath: (p) => (p.endsWith("/") ? `${p}index.html` : p),
    onFound(caminho, c) {
      if (/\.(webp|png|woff2|mp4)$/.test(caminho)) c.header("Cache-Control", "public, max-age=604800");
    },
  });
  // Arquivos de configuração da Cloudflare (_headers etc.) não são servidos, igual em produção.
  const bloqueados = (c) => /\/_[^/]*$/.test(c.req.path);
  return {
    servir: async (c, next) => {
      if (bloqueados(c)) return next();
      const r = await servir(c, next);
      if (r || c.finalized) return r;
      // /agendamento -> agendamento.html, como na Cloudflare
      if (!path.extname(c.req.path) && fs.existsSync(path.join(PASTA_PUBLICA, `${c.req.path}.html`))) {
        return c.redirect(`${c.req.path}.html${new URL(c.req.url).search}`, 307);
      }
      return next();
    },
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
