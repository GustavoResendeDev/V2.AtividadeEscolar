const { test, describe, beforeEach } = require("node:test");
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
  test("aceita celular e fixo com DDD, com ou sem +55", () => {
    assert.equal(normalizarTelefone("(62) 99999-0001"), "62999990001");
    assert.equal(normalizarTelefone("+55 62 99999-0001"), "62999990001");
    assert.equal(normalizarTelefone("62 3222-1100"), "6232221100");
  });
  test("recusa números inválidos", () => {
    ["", "999990001", "(62) 89999-0001", "00 99999-0001", "abc"].forEach((n) =>
      assert.equal(normalizarTelefone(n), null, n)
    );
  });
  test("formata para exibição", () => {
    assert.equal(formatarTelefone("62999990001"), "(62) 99999-0001");
    assert.equal(formatarTelefone("6232221100"), "(62) 3222-1100");
  });
});

describe("Agenda", () => {
  let db, agenda, agora;
  beforeEach(() => {
    db = bancoDeTeste();
    agora = relogio();
    agenda = criarAgenda(db, { agora });
  });

  test("cria agendamento pendente com término calculado pela duração", () => {
    const a = agenda.criarAgendamento(pedido());
    assert.equal(a.status, "pendente");
    assert.equal(a.hora, "09:00");
    assert.equal(a.termino, "10:00");
    assert.equal(a.preco, 40);
    assert.match(a.codigo, /^[0-9A-F]{8}$/);
  });

  test("impede dois agendamentos sobrepostos para o mesmo barbeiro", () => {
    agenda.criarAgendamento(pedido());
    assert.throws(() => agenda.criarAgendamento(pedido({ hora: "09:30", telefone: "62999990002" })), {
      status: 409,
    });
  });

  test("permite o mesmo horário com outro barbeiro", () => {
    agenda.criarAgendamento(pedido());
    const b = agenda.criarAgendamento(pedido({ barbeiroId: 2, telefone: "62999990002" }));
    assert.equal(b.barbeiro.id, 2);
  });

  test("cancelar libera o horário", () => {
    const a = agenda.criarAgendamento(pedido());
    agenda.mudarStatus(a.id, "cancelado", { id: 1, papel: "admin" });
    assert.doesNotThrow(() => agenda.criarAgendamento(pedido({ telefone: "62999990002" })));
  });

  test("sem preferência: escolhe o barbeiro livre com menos atendimentos", () => {
    agenda.criarAgendamento(pedido({ barbeiroId: 1, hora: "08:00" }));
    agenda.criarAgendamento(pedido({ barbeiroId: 2, hora: "08:00", telefone: "62999990002" }));
    agenda.criarAgendamento(pedido({ barbeiroId: 2, hora: "10:00", telefone: "62999990003" }));
    const a = agenda.criarAgendamento(pedido({ barbeiroId: null, hora: "11:00", telefone: "62999990004" }));
    assert.equal(a.barbeiro.id, 3);
  });

  test("sem preferência: recusa quando todos estão ocupados", () => {
    [1, 2, 3].forEach((id, i) =>
      agenda.criarAgendamento(pedido({ barbeiroId: id, telefone: `6299999000${i + 1}` }))
    );
    assert.throws(() => agenda.criarAgendamento(pedido({ barbeiroId: null, telefone: "62999990009" })), {
      status: 409,
    });
  });

  test("recusa domingo, feriado, data passada e data distante", () => {
    for (const data of ["2026-11-22", "2026-11-20", "2026-11-17", "2027-03-01"]) {
      assert.throws(() => agenda.criarAgendamento(pedido({ data })), { status: 422, campo: "data" }, data);
    }
  });

  test("recusa horário que já passou hoje e serviço que termina depois das 19h", () => {
    assert.throws(() => agenda.criarAgendamento(pedido({ data: "2026-11-18", hora: "09:30" })), { campo: "hora" });
    assert.throws(() => agenda.criarAgendamento(pedido({ servicoId: 3, hora: "17:00" })), { campo: "hora" });
    assert.throws(() => agenda.criarAgendamento(pedido({ hora: "09:15" })), { campo: "hora" });
  });

  test("exige consentimento, nome e telefone", () => {
    assert.throws(() => agenda.criarAgendamento(pedido({ consentimento: false })), { campo: "consentimento" });
    assert.throws(() => agenda.criarAgendamento(pedido({ consentimento: "true" })), { campo: "consentimento" });
    assert.throws(() => agenda.criarAgendamento(pedido({ nome: "  A " })), { campo: "nome" });
    assert.throws(() => agenda.criarAgendamento(pedido({ telefone: "123" })), { campo: "telefone" });
  });

  test("disponibilidade marca ocupado e esconde horários passados", () => {
    agenda.criarAgendamento(pedido({ data: "2026-11-18", hora: "11:00" }));
    const horarios = agenda.disponibilidade({ data: "2026-11-18", servicoId: 1, barbeiroId: 1 });
    assert.equal(horarios[0].hora, "10:30"); // são 10h: 08h00 a 10h00 já passaram
    const mapa = Object.fromEntries(horarios.map((h) => [h.hora, h.disponivel]));
    assert.equal(mapa["10:30"], false); // terminaria 11h30, sobrepõe
    assert.equal(mapa["11:00"], false);
    assert.equal(mapa["12:00"], true);
  });

  test("segue a máquina de estados e grava o histórico", () => {
    const a = agenda.criarAgendamento(pedido());
    const admin = { id: 1, papel: "admin" };
    assert.throws(() => agenda.mudarStatus(a.id, "concluido", admin), { status: 422 });
    agenda.mudarStatus(a.id, "confirmado", admin);
    const fim = agenda.mudarStatus(a.id, "concluido", admin);
    assert.deepEqual(fim.proximosStatus, []);
    const historico = db.prepare("SELECT de, para FROM historico_status WHERE agendamento_id = ? ORDER BY id").all(a.id);
    assert.deepEqual(historico.map((h) => `${h.de}>${h.para}`), ["null>pendente", "pendente>confirmado", "confirmado>concluido"]);
  });

  test("barbeiro não altera atendimento de outro barbeiro", () => {
    const a = agenda.criarAgendamento(pedido({ barbeiroId: 2 }));
    assert.throws(() => agenda.mudarStatus(a.id, "confirmado", { id: 2, papel: "barbeiro", barbeiro_id: 1 }), {
      status: 403,
    });
  });

  test("resumo soma previsão e recebido", () => {
    const admin = { id: 1, papel: "admin" };
    const a = agenda.criarAgendamento(pedido()); // R$ 40
    const b = agenda.criarAgendamento(pedido({ servicoId: 2, hora: "10:00", telefone: "62999990002" })); // R$ 75
    agenda.criarAgendamento(pedido({ hora: "11:00", telefone: "62999990003" }));
    agenda.mudarStatus(a.id, "confirmado", admin);
    agenda.mudarStatus(a.id, "concluido", admin);
    agenda.mudarStatus(b.id, "cancelado", admin);
    const r = agenda.resumo({ data: "2026-11-21" });
    assert.equal(r.total, 2);
    assert.equal(r.cancelados, 1);
    assert.equal(r.faturamentoPrevisto, 80);
    assert.equal(r.faturamentoRealizado, 40);
  });

  test("LGPD: anonimiza clientes sem atendimento nos últimos 180 dias", () => {
    agenda.criarAgendamento(pedido());
    agora.definir("2027-06-01T13:00:00Z"); // mais de 180 dias depois
    assert.equal(agenda.anonimizarAntigos(), 1);
    const [a] = agenda.listar({ data: "2026-11-21" });
    assert.equal(a.cliente.nome, "Cliente anonimizado");
    assert.equal(a.cliente.whatsapp, null);
    assert.equal(agenda.anonimizarAntigos(), 0); // não repete
  });
});
