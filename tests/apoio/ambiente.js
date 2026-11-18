/* Utilitários de teste: banco em memória, relógio fixo e servidor HTTP em porta livre. */
const { abrirBanco } = require("../../server/db");
const { criarApp } = require("../../server/app");
const { criarUsuario } = require("../../server/usuarios");

// Quarta-feira, 18/11/2026, 10h00 em Brasília (13h00 UTC).
const AGORA_PADRAO = "2026-11-18T13:00:00Z";
const SENHA = "senha-de-teste-123";
const logMudo = { info() {}, warn() {}, error() {} };

function relogio(iso = AGORA_PADRAO) {
  let atual = new Date(iso);
  const agora = () => new Date(atual);
  agora.definir = (novo) => (atual = new Date(novo));
  return agora;
}

function bancoDeTeste() {
  const db = abrirBanco(":memory:");
  criarUsuario(db, { nome: "Admin", email: "admin@teste.com", senha: SENHA, papel: "admin" });
  criarUsuario(db, { nome: "Rafael Moura", email: "rafael@teste.com", senha: SENHA, papel: "barbeiro", barbeiroId: 1 });
  return db;
}

async function subirServidor({ agora = relogio() } = {}) {
  const db = bancoDeTeste();
  const app = criarApp({ db, agora, log: logMudo });
  const servidor = await new Promise((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function req(metodo, caminho, { corpo, cookie, cabecalhos = {} } = {}) {
    const resposta = await fetch(base + caminho, {
      method: metodo,
      headers: {
        ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...cabecalhos,
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    const texto = await resposta.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* resposta sem JSON */
    }
    return { status: resposta.status, json, headers: resposta.headers, texto };
  }

  async function login(email = "admin@teste.com", senha = SENHA) {
    const r = await req("POST", "/api/admin/login", { corpo: { email, senha } });
    return r.headers.get("set-cookie")?.split(";")[0];
  }

  const fechar = () => new Promise((ok) => servidor.close(() => (db.close(), ok())));
  return { base, db, agora, req, login, fechar };
}

module.exports = { relogio, bancoDeTeste, subirServidor, SENHA, AGORA_PADRAO, logMudo };
