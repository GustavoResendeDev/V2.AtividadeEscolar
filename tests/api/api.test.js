const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirServidor, SENHA } = require("../apoio/ambiente");

const corpo = (extra = {}) => ({
  nome: "Pedro Alves",
  telefone: "(62) 98888-1111",
  servicoId: 2,
  barbeiroId: 1,
  data: "2026-11-21",
  hora: "14:00",
  consentimento: true,
  ...extra,
});

describe("API pública", () => {
  let s;
  before(async () => (s = await subirServidor()));
  after(() => s.fechar());

  test("GET /api/servicos lista os 9 serviços do menu", async () => {
    const r = await s.req("GET", "/api/servicos");
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 9);
    assert.deepEqual(Object.keys(r.json[0]).sort(), ["categoria", "duracao_min", "id", "nome", "preco_centavos"]);
  });

  test("GET /api/barbeiros lista os barbeiros ativos", async () => {
    const r = await s.req("GET", "/api/barbeiros");
    assert.deepEqual(r.json.map((b) => b.nome), ["Rafael Moura", "Thiago Brandão", "Caio Henrique"]);
  });

  test("GET /api/disponibilidade valida a data", async () => {
    const domingo = await s.req("GET", "/api/disponibilidade?data=2026-11-22&servico=1");
    assert.equal(domingo.status, 422);
    assert.equal(domingo.json.campo, "data");
    const ok = await s.req("GET", "/api/disponibilidade?data=2026-11-21&servico=1&barbeiro=1");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.horarios.length, 21);
  });

  test("POST /api/agendamentos cria e devolve o link do WhatsApp", async () => {
    const r = await s.req("POST", "/api/agendamentos", { corpo: corpo() });
    assert.equal(r.status, 201);
    assert.equal(r.json.barbeiro, "Rafael Moura");
    assert.equal(r.json.termino, "15:00");
    assert.ok(r.json.whatsapp.startsWith("https://wa.me/5562993548184?text="));
    assert.match(decodeURIComponent(r.json.whatsapp), new RegExp(r.json.codigo));
  });

  test("POST com conflito devolve 409 e a disponibilidade passa a mostrar ocupado", async () => {
    const r = await s.req("POST", "/api/agendamentos", { corpo: corpo({ telefone: "62988882222", hora: "14:30" }) });
    assert.equal(r.status, 409);
    const d = await s.req("GET", "/api/disponibilidade?data=2026-11-21&servico=2&barbeiro=1");
    assert.equal(d.json.horarios.find((h) => h.hora === "14:00").disponivel, false);
  });

  test("POST com dados inválidos devolve 422 indicando o campo", async () => {
    const r = await s.req("POST", "/api/agendamentos", { corpo: corpo({ consentimento: false }) });
    assert.equal(r.status, 422);
    assert.equal(r.json.campo, "consentimento");
  });

  test("recusa escrita que não seja JSON (proteção contra envio de outros sites)", async () => {
    const r = await s.req("POST", "/api/agendamentos", {
      cabecalhos: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assert.equal(r.status, 415);
  });

  test("JSON malformado devolve 400", async () => {
    const r = await fetch(s.base + "/api/agendamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{nome:",
    });
    assert.equal(r.status, 400);
  });

  test("envia cabeçalhos de segurança e não expõe arquivos do servidor", async () => {
    const r = await s.req("GET", "/");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-powered-by"), null);
    for (const caminho of ["/package.json", "/server/app.js", "/dados/novaera.db"]) {
      assert.equal((await s.req("GET", caminho)).status, 404, caminho);
    }
  });
});

describe("API do painel", () => {
  let s;
  before(async () => (s = await subirServidor()));
  after(() => s.fechar());

  test("rotas do painel exigem login", async () => {
    assert.equal((await s.req("GET", "/api/admin/agendamentos?data=2026-11-21")).status, 401);
    assert.equal((await s.req("PATCH", "/api/admin/agendamentos/1", { corpo: { status: "confirmado" } })).status, 401);
  });

  test("login correto cria cookie de sessão seguro", async () => {
    const r = await s.req("POST", "/api/admin/login", { corpo: { email: "admin@teste.com", senha: SENHA } });
    assert.equal(r.status, 200);
    assert.equal(r.json.papel, "admin");
    assert.equal(r.json.senha_hash, undefined);
    const cookie = r.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });

  test("admin vê todos; barbeiro vê só os próprios atendimentos", async () => {
    await s.req("POST", "/api/agendamentos", { corpo: corpo({ barbeiroId: 1, hora: "09:00" }) });
    await s.req("POST", "/api/agendamentos", { corpo: corpo({ barbeiroId: 2, hora: "09:00", telefone: "62977776666" }) });
    const admin = await s.login();
    const barbeiro = await s.login("rafael@teste.com");
    const todos = await s.req("GET", "/api/admin/agendamentos?data=2026-11-21", { cookie: admin });
    const proprios = await s.req("GET", "/api/admin/agendamentos?data=2026-11-21&barbeiro=2", { cookie: barbeiro });
    assert.equal(todos.json.agendamentos.length, 2);
    assert.equal(proprios.json.agendamentos.length, 1);
    assert.equal(proprios.json.agendamentos[0].barbeiro.nome, "Rafael Moura");
  });

  test("PATCH muda a situação e respeita as transições", async () => {
    const cookie = await s.login();
    const { json } = await s.req("GET", "/api/admin/agendamentos?data=2026-11-21", { cookie });
    const id = json.agendamentos[0].id;
    const invalida = await s.req("PATCH", `/api/admin/agendamentos/${id}`, { cookie, corpo: { status: "concluido" } });
    assert.equal(invalida.status, 422);
    const ok = await s.req("PATCH", `/api/admin/agendamentos/${id}`, { cookie, corpo: { status: "confirmado" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.status, "confirmado");
    assert.deepEqual(ok.json.proximosStatus, ["concluido", "faltou", "cancelado"]);
  });

  test("logout invalida a sessão", async () => {
    const cookie = await s.login();
    assert.equal((await s.req("POST", "/api/admin/logout", { cookie, corpo: {} })).status, 204);
    assert.equal((await s.req("GET", "/api/admin/me", { cookie })).status, 401);
  });

  test("bloqueia o IP após 5 senhas erradas", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await s.req("POST", "/api/admin/login", { corpo: { email: "admin@teste.com", senha: "errada" } });
      assert.equal(r.status, 401);
    }
    const bloqueado = await s.req("POST", "/api/admin/login", { corpo: { email: "admin@teste.com", senha: SENHA } });
    assert.equal(bloqueado.status, 429);
    assert.ok(Number(bloqueado.headers.get("retry-after")) > 0);
  });
});
