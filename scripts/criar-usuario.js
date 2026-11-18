/* Cria ou atualiza um usuário do painel.
   Uso: npm run usuario -- --nome "Ana" --email ana@novaera.com.br --senha "senhaForte123" [--papel barbeiro --barbeiro 2] */
const { parseArgs } = require("node:util");
const config = require("../server/config");
const { abrirBanco } = require("../server/db");
const { criarUsuario } = require("../server/usuarios");

const { values } = parseArgs({
  options: {
    nome: { type: "string" },
    email: { type: "string" },
    senha: { type: "string" },
    papel: { type: "string", default: "admin" },
    barbeiro: { type: "string" },
  },
});

try {
  const db = abrirBanco(config.caminhoBanco);
  const usuario = criarUsuario(db, { ...values, barbeiroId: values.barbeiro ? Number(values.barbeiro) : null });
  console.info("Usuário salvo:", usuario);
  db.close();
} catch (erro) {
  console.error("Não foi possível salvar o usuário:", erro.message);
  process.exit(1);
}
