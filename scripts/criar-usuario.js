/* Cria ou atualiza um usuário do painel no banco da Supabase.
   Uso: DATABASE_URL=... npm run usuario -- --nome "Ana" --email ana@novaera.com.br --senha "senhaForte123" [--papel barbeiro --barbeiro 2] */
const { parseArgs } = require("node:util");
const { bancoPostgres } = require("../server/banco");
const { criarUsuario } = require("../server/auth");

const { values } = parseArgs({
  options: {
    nome: { type: "string" },
    email: { type: "string" },
    senha: { type: "string" },
    papel: { type: "string", default: "admin" },
    barbeiro: { type: "string" },
  },
});

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("Defina DATABASE_URL (string de conexão da Supabase).");
    process.exit(1);
  }
  const db = bancoPostgres(process.env.DATABASE_URL);
  try {
    const usuario = await criarUsuario(db, { ...values, barbeiroId: values.barbeiro ? Number(values.barbeiro) : null });
    console.info("Usuário salvo:", usuario);
  } catch (erro) {
    console.error("Não foi possível salvar o usuário:", erro.message);
    process.exitCode = 1;
  } finally {
    await db.fechar();
  }
})();
