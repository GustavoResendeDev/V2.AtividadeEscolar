const { test, describe, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { criarAgenda, normalizarTelefone, formatarTelefone } = require("../../server/agenda");
const { bancoDeTeste, relogio } = require("../apoio/ambiente");

const pedido = (extra = {}) => ({
  nome: "Cliente Teste",
  telefone: "(62) 99999-0001",
  servicoId: 1, // Corte Masculino, 60 min
  barbeiroId: 1,
  data: "2026-11-21",
  hora: "09:00",
  consentimento: true,
  ...extra,
});

describe("Telefone", () => {
  test("aceita celular e fixo com DDD, com ou sem +55", async () => {
    assert.equal(normalizarTelefone("(62) 99999-0001"), "62999990001");
    assert.equal(normalizarTelefone("+55 62 99999-0001"), "62999990001");
    assert.equal(normalizarTelefone("62 3222-1100"), "6232221100");
  });
  test("recusa números inválidos", async () => {
    ["", "999990001", "(62) 89999-0001", "00 99999-0001", "abc"].forEach((n) =>
      assert.equal(normalizarTelefone(n), null, n)
    );
  });
  test("formata para exibição", async () => {
    assert.equal(formatarTelefone("62999990001"), "(62) 99999-0001");
    assert.equal(formatarTelefone("6232221100"), "(62) 3222-1100");
  });
});

describe("Agenda", () => {
  let db, agenda, agora;
  beforeEach(async () => {
    await db?.fechar();
    db = await bancoDeTeste();
    agora = relogio();
    agenda = criarAgenda(db, { agora });
  });
  after(() => db?.fechar());

  test("dois clientes no mesmo horário ao mesmo tempo: só um consegue", async () => {
    const resultados = await Promise.allSettled([
      agenda.criarAgendamento(pedido()),
      agenda.criarAgendamento(pedido({ telefone: "62999990002" })),
    ]);
    assert.deepEqual(resultados.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    assert.equal(resultados.find((r) => r.status === "rejected").reason.status, 409);
  });

  test("cria agendamento pendente com término calculado pela duração", async () => {
    const a = await agenda.criarAgendamento(pedido());
    assert.equal(a.status, "pendente");
    assert.equal(a.hora, "09:00");
    assert.equal(a.termino, "10:00");
    assert.equal(a.preco, 40);
    assert.match(a.codigo, /^[0-9A-F]{8}$/);
  });

  test("impede dois agendamentos sobrepostos para o mesmo barbeiro", async () => {
    await agenda.criarAgendamento(pedido());
    await assert.rejects(() => agenda.criarAgendamento(pedido({ hora: "09:30", telefone: "62999990002" })), {
      status: 409,
    });
  });

  test("permite o mesmo horário com outro barbeiro", async () => {
    await agenda.criarAgendamento(pedido());
    const b = await agenda.criarAgendamento(pedido({ barbeiroId: 2, telefone: "62999990002" }));
    assert.equal(b.barbeiro.id, 2);
  });

  test("cancelar libera o horário", async () => {
    const a = await agenda.criarAgendamento(pedido());
    await agenda.mudarStatus(a.id, "cancelado", { id: 1, papel: "admin" });
    await assert.doesNotReject(() => agenda.criarAgendamento(pedido({ telefone: "62999990002" })));
  });

  test("sem preferência: escolhe o barbeiro livre com menos atendimentos", async () => {
    await agenda.criarAgendamento(pedido({ barbeiroId: 1, hora: "08:00" }));
    await agenda.criarAgendamento(pedido({ barbeiroId: 2, hora: "08:00", telefone: "62999990002" }));
    await agenda.criarAgendamento(pedido({ barbeiroId: 2, hora: "10:00", telefone: "62999990003" }));
    const a = await agenda.criarAgendamento(pedido({ barbeiroId: null, hora: "11:00", telefone: "62999990004" }));
    assert.equal(a.barbeiro.id, 3);
  });

  test("sem preferência: recusa quando todos estão ocupados", async () => {
    for (const [i, id] of [1, 2, 3].entries())
      await agenda.criarAgendamento(pedido({ barbeiroId: id, telefone: `6299999000${i + 1}` }));
    await assert.rejects(() => agenda.criarAgendamento(pedido({ barbeiroId: null, telefone: "62999990009" })), {
      status: 409,
    });
  });

  test("recusa domingo, feriado, data passada e data distante", async () => {
    for (const data of ["2026-11-22", "2026-11-20", "2026-11-17", "2027-03-01"]) {
      await assert.rejects(() => agenda.criarAgendamento(pedido({ data })), { status: 422, campo: "data" }, data);
    }
  });

  test("recusa horário que já passou hoje e serviço que termina depois das 19h", async () => {
    await assert.rejects(() => agenda.criarAgendamento(pedido({ data: "2026-11-18", hora: "09:30" })), { campo: "hora" });
    await assert.rejects(() => agenda.criarAgendamento(pedido({ servicoId: 3, hora: "17:00" })), { campo: "hora" });
    await assert.rejects(() => agenda.criarAgendamento(pedido({ hora: "09:15" })), { campo: "hora" });
  });

  test("exige consentimento, nome e telefone", async () => {
    await assert.rejects(() => agenda.criarAgendamento(pedido({ consentimento: false })), { campo: "consentimento" });
    await assert.rejects(() => agenda.criarAgendamento(pedido({ consentimento: "true" })), { campo: "consentimento" });
    await assert.rejects(() => agenda.criarAgendamento(pedido({ nome: "  A " })), { campo: "nome" });
    await assert.rejects(() => agenda.criarAgendamento(pedido({ telefone: "123" })), { campo: "telefone" });
  });

  test("disponibilidade marca ocupado e esconde horários passados", async () => {
    await agenda.criarAgendamento(pedido({ data: "2026-11-18", hora: "11:00" }));
    const horarios = await agenda.disponibilidade({ data: "2026-11-18", servicoId: 1, barbeiroId: 1 });
    assert.equal(horarios[0].hora, "10:30"); // são 10h: 08h00 a 10h00 já passaram
    const mapa = Object.fromEntries(horarios.map((h) => [h.hora, h.disponivel]));
    assert.equal(mapa["10:30"], false); // terminaria 11h30, sobrepõe
    assert.equal(mapa["11:00"], false);
    assert.equal(mapa["12:00"], true);
  });

  test("segue a máquina de estados e grava o histórico", async () => {
    const a = await agenda.criarAgendamento(pedido());
    const admin = { id: 1, papel: "admin" };
    await assert.rejects(() => agenda.mudarStatus(a.id, "concluido", admin), { status: 422 });
    await agenda.mudarStatus(a.id, "confirmado", admin);
    const fim = await agenda.mudarStatus(a.id, "concluido", admin);
    assert.deepEqual(fim.proximosStatus, []);
    const historico = await db.query("SELECT de, para FROM historico_status WHERE agendamento_id = $1 ORDER BY id", [a.id]);
    assert.deepEqual(historico.map((h) => `${h.de}>${h.para}`), ["null>pendente", "pendente>confirmado", "confirmado>concluido"]);
  });

  test("barbeiro não altera atendimento de outro barbeiro", async () => {
    const a = await agenda.criarAgendamento(pedido({ barbeiroId: 2 }));
    await assert.rejects(() => agenda.mudarStatus(a.id, "confirmado", { id: 2, papel: "barbeiro", barbeiro_id: 1 }), {
      status: 403,
    });
  });

  test("resumo soma previsão e recebido", async () => {
    const admin = { id: 1, papel: "admin" };
    const a = await agenda.criarAgendamento(pedido()); // R$ 40
    const b = await agenda.criarAgendamento(pedido({ servicoId: 2, hora: "10:00", telefone: "62999990002" })); // R$ 75
    await agenda.criarAgendamento(pedido({ hora: "11:00", telefone: "62999990003" }));
    await agenda.mudarStatus(a.id, "confirmado", admin);
    await agenda.mudarStatus(a.id, "concluido", admin);
    await agenda.mudarStatus(b.id, "cancelado", admin);
    const r = await agenda.resumo({ data: "2026-11-21" });
    assert.equal(r.total, 2);
    assert.equal(r.cancelados, 1);
    assert.equal(r.faturamentoPrevisto, 80);
    assert.equal(r.faturamentoRealizado, 40);
  });

  test("LGPD: anonimiza clientes sem atendimento nos últimos 180 dias", async () => {
    await agenda.criarAgendamento(pedido());
    agora.definir("2027-06-01T13:00:00Z"); // mais de 180 dias depois
    assert.equal(await agenda.anonimizarAntigos(), 1);
    const [a] = await agenda.listar({ data: "2026-11-21" });
    assert.equal(a.cliente.nome, "Cliente anonimizado");
    assert.equal(a.cliente.whatsapp, null);
    assert.equal(await agenda.anonimizarAntigos(), 0); // não repete
  });
});
