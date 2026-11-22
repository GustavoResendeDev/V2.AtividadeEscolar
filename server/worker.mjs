/* Entrada do Cloudflare Worker.
   fetch: a Cloudflare entrega as páginas de public/ (static assets) e manda só /api/* para cá.
   scheduled: tarefa diária (cron em wrangler.toml) de anonimização LGPD e limpeza de sessões.
   Segredos (wrangler secret / GitHub Actions): DATABASE_URL, RESEND_API_KEY, EMAIL_AVISO_PARA. */
import { criarApp } from "./app.js";
import { bancoPostgres } from "./banco.js";
import { criarAgenda } from "./agenda.js";
import { limparExpirados } from "./auth.js";
import { enviarAviso } from "./email.js";

const app = criarApp({
  banco: (c) => c.env.db,
  producao: true,
  aoCriarAgendamento(agendamento, c) {
    const urlPainel = new URL("/admin/painel.html", c.req.url).href;
    c.executionCtx.waitUntil(
      enviarAviso(c.env, agendamento, { urlPainel }).catch((erro) => console.error("Falha no e-mail de aviso:", erro))
    );
  },
});

export default {
  async fetch(request, env, ctx) {
    const db = bancoPostgres(env.DATABASE_URL); // conecta só na primeira consulta
    try {
      return await app.fetch(request, { ...env, db }, ctx);
    } finally {
      ctx.waitUntil(db.fechar());
    }
  },

  async scheduled(evento, env, ctx) {
    const db = bancoPostgres(env.DATABASE_URL);
    try {
      const n = await criarAgenda(db).anonimizarAntigos();
      await limparExpirados(db);
      console.info(`Manutenção diária: ${n} cliente(s) anonimizado(s).`);
    } finally {
      ctx.waitUntil(db.fechar());
    }
  },
};
