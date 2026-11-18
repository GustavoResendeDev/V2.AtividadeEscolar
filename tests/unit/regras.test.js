const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../../public/js/regras.js");

describe("Regras de funcionamento", () => {
  test("calcula a Páscoa corretamente (anos conhecidos)", () => {
    assert.equal(r.pascoa(2024).toISOString().slice(0, 10), "2024-03-31");
    assert.equal(r.pascoa(2025).toISOString().slice(0, 10), "2025-04-20");
    assert.equal(r.pascoa(2026).toISOString().slice(0, 10), "2026-04-05");
  });

  test("reconhece feriados fixos e a Sexta-feira Santa", () => {
    assert.equal(r.eFeriado(2026, 12, 25), true);
    assert.equal(r.eFeriado(2026, 11, 20), true); // Consciência Negra
    assert.equal(r.eFeriado(2026, 4, 3), true); // Sexta-feira Santa de 2026
    assert.equal(r.eFeriado(2026, 11, 18), false);
  });

  test("usa o horário de Brasília, não o do computador", () => {
    // 02h00 UTC de 19/11 ainda é 23h00 de 18/11 em Brasília.
    const agora = r.agoraEmBrasilia(new Date("2026-11-19T02:00:00Z"));
    assert.deepEqual([agora.dia, agora.mes, agora.minutos], [18, 11, 23 * 60]);
    assert.equal(r.hojeISO(new Date("2026-11-19T02:00:00Z")), "2026-11-18");
  });

  test("informa se está aberto", () => {
    assert.equal(r.estaAberto(new Date("2026-11-18T13:00:00Z")), true); // quarta, 10h
    assert.equal(r.estaAberto(new Date("2026-11-18T22:30:00Z")), false); // quarta, 19h30
    assert.equal(r.estaAberto(new Date("2026-11-22T13:00:00Z")), false); // domingo
    assert.equal(r.estaAberto(new Date("2026-12-25T13:00:00Z")), false); // Natal
  });

  test("explica por que a data está fechada", () => {
    assert.equal(r.motivoDataFechada("2026-11-22"), "Não abrimos aos domingos.");
    assert.match(r.motivoDataFechada("2026-11-20"), /feriado/);
    assert.equal(r.motivoDataFechada("2026-11-21"), "");
  });

  test("valida datas e horas", () => {
    assert.equal(r.dataValida("2026-02-29"), false);
    assert.equal(r.dataValida("2028-02-29"), true);
    assert.equal(r.dataValida("21/11/2026"), false);
    assert.equal(r.paraMinutos("09:30"), 570);
    assert.ok(Number.isNaN(r.paraMinutos("25:00")));
    assert.equal(r.paraHora(570), "09:30");
    assert.equal(r.somarDias("2026-12-31", 1), "2027-01-01");
  });

  test("monta a grade sem passar do fechamento", () => {
    const grade60 = r.gradeDeHorarios(60);
    assert.equal(r.paraHora(grade60[0]), "08:00");
    assert.equal(r.paraHora(grade60.at(-1)), "18:00");
    const grade140 = r.gradeDeHorarios(140); // 2h20 precisa começar até 16h30
    assert.equal(r.paraHora(grade140.at(-1)), "16:30");
  });

  test("detecta sobreposição de horários", () => {
    assert.equal(r.sobrepoe(540, 600, 570, 630), true);
    assert.equal(r.sobrepoe(540, 600, 600, 660), false); // um termina quando o outro começa
  });
});
