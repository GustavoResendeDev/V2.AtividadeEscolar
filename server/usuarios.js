/* Cadastro de usuários do painel (usado na inicialização e pelo script npm run usuario). */
const { gerarHashSenha } = require("./auth");

function criarUsuario(db, { nome, email, senha, papel = "admin", barbeiroId = null }) {
  if (!nome || !email || !senha) throw new Error("Informe nome, e-mail e senha.");
  if (String(senha).length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (!["admin", "barbeiro"].includes(papel)) throw new Error("Papel deve ser admin ou barbeiro.");
  if (papel === "barbeiro" && !barbeiroId) throw new Error("Usuário barbeiro precisa do id do barbeiro.");
  return db
    .prepare(
      `INSERT INTO usuarios (nome, email, senha_hash, papel, barbeiro_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET nome = excluded.nome, senha_hash = excluded.senha_hash,
         papel = excluded.papel, barbeiro_id = excluded.barbeiro_id, ativo = 1
       RETURNING id, nome, email, papel, barbeiro_id`
    )
    .get(nome, String(email).trim(), gerarHashSenha(senha), papel, barbeiroId);
}

/* Primeira execução: cria o administrador. Em desenvolvimento, cria também um login
   para cada barbeiro (mesma senha de demonstração), útil na apresentação e nos testes. */
function garantirUsuariosIniciais(db, { admin, producao }, log = console) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM usuarios").get();
  if (n > 0) return;
  if (!admin.email || !admin.senha) {
    log.warn("Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_SENHA ou rode: npm run usuario");
    return;
  }
  criarUsuario(db, { nome: admin.nome, email: admin.email, senha: admin.senha, papel: "admin" });
  log.info(`Administrador criado: ${admin.email}`);

  if (!producao) {
    const barbeiros = db.prepare("SELECT id, nome FROM barbeiros ORDER BY id").all();
    for (const b of barbeiros) {
      const login = b.nome.split(" ")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      criarUsuario(db, { nome: b.nome, email: `${login}@novaera.com.br`, senha: admin.senha, papel: "barbeiro", barbeiroId: b.id });
    }
    log.warn(`Ambiente de desenvolvimento: logins de demonstração com a senha "${admin.senha}".`);
  }
}

module.exports = { criarUsuario, garantirUsuariosIniciais };
