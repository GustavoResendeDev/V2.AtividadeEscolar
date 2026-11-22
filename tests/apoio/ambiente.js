/* Utilitários de teste: banco PGlite em memória, relógio fixo e servidor HTTP em porta livre. */
const { bancoLocal } = require("../../server/banco-local");
const { criarAppLocal, iniciar } = require("../../server/local");
const { criarUsuario } = require("../../server/auth");

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

async function bancoDeTeste({ barbeiro = true } = {}) {
  const db = await bancoLocal();
  await criarUsuario(db, { nome: "Admin", email: "admin@teste.com", senha: SENHA, papel: "admin" });
  if (barbeiro)
    await criarUsuario(db, { nome: "Rafael Moura", email: "rafael@teste.com", senha: SENHA, papel: "barbeiro", barbeiroId: 1 });
  return db;
}

/* Sobe o sistema completo (API + páginas) com um banco novo. `agora: null` usa o relógio real (testes no navegador). */
async function subirServidor({ agora = relogio(), barbeiro = true } = {}) {
  const db = await bancoDeTeste({ barbeiro });
  const app = criarAppLocal({ banco: db, log: logMudo, ...(agora ? { agora } : {}) });
  const http = await iniciar(app, 0);
  const base = `http://127.0.0.1:${http.porta}`;

  async function req(metodo, caminho, { corpo, cookie, cabecalhos = {} } = {}) {
    const resposta = await fetch(base + caminho, {
      method: metodo,
      headers: {
        ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...cabecalhos,
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      redirect: "manual",
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

  const fechar = async () => {
    await http.fechar();
    await db.fechar();
  };
  return { base, db, agora, req, login, fechar };
}

module.exports = { relogio, bancoDeTeste, subirServidor, SENHA, AGORA_PADRAO, logMudo };
