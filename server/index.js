/* npm start: roda o sistema completo no seu computador, sem conta em lugar nenhum.
   Banco PGlite (Postgres em WebAssembly) guardado em dados/pglite. Produção roda no Cloudflare Worker. */
const path = require("node:path");
const { bancoLocal } = require("./banco-local");
const { criarAppLocal, iniciar } = require("./local");
const { criarAgenda } = require("./agenda");
const { garantirUsuariosIniciais } = require("./usuarios");

const porta = Number(process.env.PORT) || 3000;
const pasta = process.env.PGLITE_DIR || path.join(__dirname, "..", "dados", "pglite");

(async () => {
  const db = await bancoLocal(pasta);
  await garantirUsuariosIniciais(db, {
    producao: false,
    admin: {
      nome: process.env.ADMIN_NOME || "Administrador",
      email: process.env.ADMIN_EMAIL || "admin@novaera.com.br",
      senha: process.env.ADMIN_SENHA || "novaera2026",
    },
  });
  const n = await criarAgenda(db).anonimizarAntigos();
  if (n) console.info(`Manutenção: ${n} cliente(s) anonimizado(s) por prazo de retenção.`);

  const { fechar } = await iniciar(criarAppLocal({ banco: db }), porta);
  console.info(`Nova Era Barbearia rodando em http://localhost:${porta}`);
  console.info(`Painel do barbeiro: http://localhost:${porta}/admin/`);

  const encerrar = async () => {
    await fechar();
    await db.fechar();
    process.exit(0);
  };
  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
})();
