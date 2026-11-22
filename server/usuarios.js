/* Usuários iniciais do painel (deploy, npm start e testes). */
const { criarUsuario } = require("./auth");

/* Primeira execução: cria o administrador. Em desenvolvimento, cria também um login
   para cada barbeiro (mesma senha de demonstração), útil na apresentação e nos testes. */
async function garantirUsuariosIniciais(db, { admin, producao }, log = console) {
  const { n } = await db.um("SELECT COUNT(*)::int AS n FROM usuarios");
  if (n > 0) return;
  if (!admin.email || !admin.senha) {
    log.warn("Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_SENHA ou rode: npm run usuario");
    return;
  }
  await criarUsuario(db, { nome: admin.nome, email: admin.email, senha: admin.senha, papel: "admin" });
  log.info(`Administrador criado: ${admin.email}`);

  if (!producao) {
    const barbeiros = await db.query("SELECT id, nome FROM barbeiros ORDER BY id");
    for (const b of barbeiros) {
      const login = b.nome.split(" ")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      await criarUsuario(db, { nome: b.nome, email: `${login}@novaera.com.br`, senha: admin.senha, papel: "barbeiro", barbeiroId: b.id });
    }
    log.warn(`Ambiente de desenvolvimento: logins de demonstração com a senha "${admin.senha}".`);
  }
}

module.exports = { criarUsuario, garantirUsuariosIniciais };
