/* Aplica db/schema.sql no Postgres da Supabase e cria o administrador na primeira vez.
   Uso: DATABASE_URL=... [ADMIN_EMAIL=... ADMIN_SENHA=...] npm run migrar
   O deploy (GitHub Actions) roda isto antes de publicar o Worker. O schema é idempotente. */
const { bancoPostgres } = require("../server/banco");
const { lerSchema } = require("../server/banco-local");
const { garantirUsuariosIniciais } = require("../server/usuarios");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Defina DATABASE_URL (string de conexão da Supabase).");
    process.exit(1);
  }
  const db = bancoPostgres(url);
  try {
    await db.executarScript(lerSchema());
    console.info("Schema aplicado.");
    await garantirUsuariosIniciais(db, {
      producao: true,
      admin: { nome: process.env.ADMIN_NOME || "Administrador", email: process.env.ADMIN_EMAIL, senha: process.env.ADMIN_SENHA },
    });
  } catch (erro) {
    console.error("Falha na migração:", erro.message);
    process.exitCode = 1;
  } finally {
    await db.fechar();
  }
})();
