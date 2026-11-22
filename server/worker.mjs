/* Entrada do Cloudflare Worker.
   fetch: a Cloudflare entrega as páginas de public/ (static assets) e manda só /api/* para cá.
   scheduled: tarefa diária (cron em wrangler.toml) de anonimização LGPD e limpeza de sessões.
   Banco: pelo Hyperdrive (binding HYPERDRIVE); DATABASE_URL fica de reserva.
   Segredos (wrangler secret / GitHub Actions): DATABASE_URL, RESEND_API_KEY, EMAIL_AVISO_PARA. */
import { criarApp } from "./app.js";
import { bancoPostgres } from "./banco.js";
import { criarAgenda } from "./agenda.js";
import { limparExpirados } from "./auth.js";
import { enviarAviso } from "./email.js";
import { criarCatalogo } from "./catalogo.js";

// Serviços e barbeiros quase nunca mudam: ficam 60 s na memória do Worker (menos idas ao banco).
const catalogo = criarCatalogo({ validadeMs: 60_000 });

function abrirBanco(env) {
  if (env.HYPERDRIVE) return bancoPostgres(env.HYPERDRIVE.connectionString, { maxConexoes: 5 });
  return bancoPostgres(env.DATABASE_URL);
}

const app = criarApp({
  banco: (c) => c.env.db,
  producao: true,
  catalogo,
  aoCriarAgendamento(agendamento, c) {
    const urlPainel = new URL("/admin/painel.html", c.req.url).href;
    c.executionCtx.waitUntil(
      enviarAviso(c.env, agendamento, { urlPainel }).catch((erro) => console.error("Falha no e-mail de aviso:", erro))
    );
  },
});

export default {
  async fetch(request, env, ctx) {
    const db = abrirBanco(env); // conecta só na primeira consulta
    try {
      return await app.fetch(request, { ...env, db }, ctx);
    } finally {
      ctx.waitUntil(db.fechar());
    }
  },

  async scheduled(evento, env, ctx) {
    const db = abrirBanco(env);
    try {
      const n = await criarAgenda(db).anonimizarAntigos();
      await limparExpirados(db);
      console.info(`Manutenção diária: ${n} cliente(s) anonimizado(s).`);
    } finally {
      ctx.waitUntil(db.fechar());
    }
  },
};
