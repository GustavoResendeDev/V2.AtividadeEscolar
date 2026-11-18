/* Ponto de entrada: abre o banco, cria o usuário inicial, sobe o servidor
   e agenda a manutenção diária (anonimização de dados antigos, conforme a LGPD). */
const config = require("./config");
const { abrirBanco } = require("./db");
const { criarApp } = require("./app");
const { criarAgenda } = require("./agenda");
const { garantirUsuariosIniciais } = require("./usuarios");

const db = abrirBanco(config.caminhoBanco);
garantirUsuariosIniciais(db, config);

function manutencao() {
  const n = criarAgenda(db).anonimizarAntigos();
  if (n) console.info(`Manutenção: ${n} cliente(s) anonimizado(s) por prazo de retenção.`);
}
manutencao();
const diaria = setInterval(manutencao, 24 * 60 * 60 * 1000);
diaria.unref();

const app = criarApp({ db, producao: config.producao });
const servidor = app.listen(config.porta, () => {
  console.info(`Nova Era Barbearia rodando em http://localhost:${config.porta}`);
  console.info(`Painel do barbeiro: http://localhost:${config.porta}/admin/`);
});

function encerrar() {
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
