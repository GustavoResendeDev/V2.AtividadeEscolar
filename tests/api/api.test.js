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

  test("GET /api/servicos lista os 10 serviços do menu, com a Sobrancelha", async () => {
    const r = await s.req("GET", "/api/servicos");
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 10);
    assert.deepEqual(
      r.json.find((x) => x.nome === "Sobrancelha"),
      { id: 10, nome: "Sobrancelha", categoria: "Barba e Bigode", duracao_min: 15, preco_centavos: 1500 }
    );
    assert.deepEqual(Object.keys(r.json[0]).sort(), ["categoria", "duracao_min", "id", "nome", "preco_centavos"]);
  });

  test("GET /api/barbeiros lista os barbeiros ativos", async () => {
    const r = await s.req("GET", "/api/barbeiros");
    assert.match(r.headers.get("cache-control"), /^public, max-age=300/);
    assert.equal((await s.req("GET", "/api/sessao")).headers.get("cache-control"), "no-store");
    assert.deepEqual(r.json.map((b) => b.nome), ["Marcio Rocha", "Kaua", "Felipe"]);
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
    assert.equal(r.json.barbeiro, "Marcio Rocha");
    assert.equal(r.json.termino, "15:00");
    assert.ok(r.json.whatsapp.startsWith("https://wa.me/5562992002388?text="));
    const mensagem = decodeURIComponent(r.json.whatsapp.split("?text=")[1]);
    assert.match(mensagem, new RegExp(r.json.codigo));
    assert.ok(!/\p{Extended_Pictographic}/u.test(mensagem), "a mensagem não pode ter emojis");
  });

  test("POST com conflito devolve 409 e a disponibilidade passa a mostrar ocupado", async () => {
    const r = await s.req("POST", "/api/agendamentos", { corpo: corpo({ telefone: "62988882222", hora: "14:30" }) });
    assert.equal(r.status, 409);
    const d = await s.req("GET", "/api/disponibilidade?data=2026-11-21&servico=2&barbeiro=1");
    assert.equal(d.json.horarios.find((h) => h.hora === "14:00").disponivel, false);
  });

  test("cliente escolhe vários serviços: soma duração e valor, e a agenda reflete o tempo total", async () => {
    const r = await s.req("POST", "/api/agendamentos", {
      corpo: corpo({ servicoId: undefined, servicoIds: [1, 7, 5], barbeiroId: 3, hora: "09:00", telefone: "62988883333" }),
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.servico, "Corte Masculino, Barba Tradicional / Modelada, Hidratação");
    assert.equal(r.json.termino, "11:00"); // 60 + 30 + 30 min
    assert.equal(r.json.preco, 105); // 40 + 35 + 30
    assert.match(decodeURIComponent(r.json.whatsapp), /\*Serviços:\* Corte Masculino, Barba Tradicional/);

    const d = await s.req("GET", "/api/disponibilidade?data=2026-11-21&servicos=1,7&barbeiro=3");
    assert.equal(d.status, 200);
    const livre = (h) => d.json.horarios.find((x) => x.hora === h)?.disponivel;
    assert.equal(livre("08:00"), false); // 08:00 + 1h30 invade 09:00
    assert.equal(livre("10:30"), false);
    assert.equal(livre("11:00"), true);
    assert.equal(d.json.horarios.at(-1).hora, "17:30"); // 1h30 precisa terminar até 19h
  });

  test("vários serviços: recusa lista vazia, serviço inexistente e fim depois do expediente", async () => {
    const vazio = await s.req("POST", "/api/agendamentos", { corpo: corpo({ servicoId: undefined, servicoIds: [] }) });
    assert.equal(vazio.status, 422);
    assert.equal(vazio.json.campo, "servico");
    const inexistente = await s.req("POST", "/api/agendamentos", { corpo: corpo({ servicoIds: [1, 999] }) });
    assert.equal(inexistente.status, 422);
    const tarde = await s.req("POST", "/api/agendamentos", {
      corpo: corpo({ servicoIds: [3, 4], hora: "15:00", barbeiroId: 2, telefone: "62988884444" }),
    });
    assert.equal(tarde.status, 422);
    assert.equal(tarde.json.campo, "hora");
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
    const barbeiro = await s.login("marcio@teste.com");
    const todos = await s.req("GET", "/api/admin/agendamentos?data=2026-11-21", { cookie: admin });
    const proprios = await s.req("GET", "/api/admin/agendamentos?data=2026-11-21&barbeiro=2", { cookie: barbeiro });
    assert.equal(todos.json.agendamentos.length, 2);
    assert.equal(proprios.json.agendamentos.length, 1);
    assert.equal(proprios.json.agendamentos[0].barbeiro.nome, "Marcio Rocha");
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

describe("API do painel: calendário, agendamento manual e relatório", () => {
  let s, admin, marcio;
  before(async () => {
    s = await subirServidor();
    admin = await s.login();
    marcio = await s.login("marcio@teste.com");
  });
  after(() => s.fechar());

  const manual = (extra = {}) => ({ nome: "João Balcão", servicoId: 1, barbeiroId: 2, data: "2026-11-19", hora: "10:00", ...extra });

  test("equipe agenda manualmente, sem telefone, e já nasce confirmado", async () => {
    const r = await s.req("POST", "/api/admin/agendamentos", { cookie: admin, corpo: manual() });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, "confirmado");
    assert.equal(r.json.barbeiro.nome, "Kaua");
    assert.equal(r.json.termino, "11:00");
    assert.equal(r.json.cliente.telefone, "");
  });

  test("agendamento manual recusa conflito, domingo e dia passado", async () => {
    assert.equal((await s.req("POST", "/api/admin/agendamentos", { cookie: admin, corpo: manual({ hora: "10:30" }) })).status, 409);
    assert.equal((await s.req("POST", "/api/admin/agendamentos", { cookie: admin, corpo: manual({ data: "2026-11-22" }) })).status, 422);
    assert.equal((await s.req("POST", "/api/admin/agendamentos", { cookie: admin, corpo: manual({ data: "2026-11-17" }) })).status, 422);
  });

  test("barbeiro só agenda para si mesmo", async () => {
    const r = await s.req("POST", "/api/admin/agendamentos", { cookie: marcio, corpo: manual({ barbeiroId: 2, nome: "Ana Lima" }) });
    assert.equal(r.status, 201);
    assert.equal(r.json.barbeiro.nome, "Marcio Rocha");
  });

  test("lista por período devolve vários dias", async () => {
    await s.req("POST", "/api/admin/agendamentos", { cookie: admin, corpo: manual({ data: "2026-11-24", nome: "Bruno Dias" }) });
    const r = await s.req("GET", "/api/admin/agendamentos?inicio=2026-11-18&fim=2026-11-30", { cookie: admin });
    assert.equal(r.status, 200);
    assert.deepEqual([...new Set(r.json.agendamentos.map((a) => a.data))], ["2026-11-19", "2026-11-24"]);
    assert.equal(r.json.resumo.total, 3);
    const longo = await s.req("GET", "/api/admin/agendamentos?inicio=2026-01-01&fim=2026-12-31", { cookie: admin });
    assert.equal(longo.status, 422);
  });

  test("remarcar (arrastar) muda data, horário e barbeiro, sem conflito", async () => {
    const { json } = await s.req("GET", "/api/admin/agendamentos?data=2026-11-24", { cookie: admin });
    const id = json.agendamentos[0].id;
    const ok = await s.req("PATCH", `/api/admin/agendamentos/${id}/horario`, {
      cookie: admin,
      corpo: { data: "2026-11-25", hora: "15:30", barbeiroId: 3 },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data, "2026-11-25");
    assert.equal(ok.json.hora, "15:30");
    assert.equal(ok.json.barbeiro.nome, "Felipe");

    const ocupado = await s.req("GET", "/api/admin/agendamentos?data=2026-11-19", { cookie: admin });
    const outro = ocupado.json.agendamentos.find((a) => a.barbeiro.id === 2).id;
    const choque = await s.req("PATCH", `/api/admin/agendamentos/${id}/horario`, {
      cookie: admin,
      corpo: { data: "2026-11-19", hora: "10:00", barbeiroId: 2 },
    });
    assert.equal(choque.status, 409);
    const proibido = await s.req("PATCH", `/api/admin/agendamentos/${outro}/horario`, {
      cookie: marcio,
      corpo: { data: "2026-11-21", hora: "10:00" },
    });
    assert.equal(proibido.status, 403);
  });

  test("relatório conta quantas pessoas cada barbeiro atendeu", async () => {
    const { json } = await s.req("GET", "/api/admin/agendamentos?data=2026-11-19", { cookie: admin });
    for (const a of json.agendamentos) {
      await s.req("PATCH", `/api/admin/agendamentos/${a.id}`, { cookie: admin, corpo: { status: "concluido" } });
    }
    const r = await s.req("GET", "/api/admin/relatorio?inicio=2026-11-01&fim=2026-11-30", { cookie: admin });
    assert.equal(r.status, 200);
    assert.equal(r.json.barbeiros.length, 3);
    const porNome = Object.fromEntries(r.json.barbeiros.map((b) => [b.nome, b]));
    assert.equal(porNome["Kaua"].atendidos, 1);
    assert.equal(porNome["Marcio Rocha"].atendidos, 1);
    assert.equal(porNome["Felipe"].atendidos, 0);
    assert.equal(porNome["Felipe"].aguardando, 1);
    assert.equal(r.json.totais.atendidos, 2);
    assert.equal(r.json.totais.faturado, 80);

    const proprio = await s.req("GET", "/api/admin/relatorio?inicio=2026-11-01&fim=2026-11-30", { cookie: marcio });
    assert.deepEqual(proprio.json.barbeiros.map((b) => b.nome), ["Marcio Rocha"]);
  });

  test("relatório: admin escolhe um barbeiro; barbeiro não consegue ver o de outro", async () => {
    const felipe = await s.req("GET", "/api/admin/relatorio?inicio=2026-11-01&fim=2026-11-30&barbeiro=3", { cookie: admin });
    assert.deepEqual(felipe.json.barbeiros.map((b) => b.nome), ["Felipe"]);
    const tentativa = await s.req("GET", "/api/admin/relatorio?inicio=2026-11-01&fim=2026-11-30&barbeiro=3", { cookie: marcio });
    assert.deepEqual(tentativa.json.barbeiros.map((b) => b.nome), ["Marcio Rocha"]);
  });

  test("agendamento manual com vários serviços soma tempo e valor", async () => {
    const r = await s.req("POST", "/api/admin/agendamentos", {
      cookie: marcio,
      corpo: manual({ servicoId: undefined, servicoIds: [1, 10], nome: "Lucas Duplo", data: "2026-11-26", hora: "09:00" }),
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.servico.nome, "Corte Masculino, Sobrancelha");
    assert.equal(r.json.servico.quantidade, 2);
    assert.equal(r.json.termino, "10:15"); // 60 + 15 min
    assert.equal(r.json.preco, 55); // 40 + 15
  });
});
