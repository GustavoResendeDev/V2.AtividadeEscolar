const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirServidor } = require("../apoio/ambiente");

describe("Apagar atendimentos", () => {
  let s, admin, marcio;
  before(async () => {
    s = await subirServidor();
    admin = await s.login();
    marcio = await s.login("marcio@teste.com");
  });
  after(() => s.fechar());

  const manual = (cookie, extra) =>
    s.req("POST", "/api/admin/agendamentos", {
      cookie,
      corpo: { nome: "Cliente Teste", servicoId: 1, data: "2026-11-19", hora: "09:00", ...extra },
    });
  const doDia = async (data) =>
    (await s.req("GET", `/api/admin/agendamentos?data=${data}`, { cookie: admin })).json.agendamentos;

  test("exige login", async () => {
    assert.equal((await s.req("DELETE", "/api/admin/agendamentos/1", { corpo: {} })).status, 401);
  });

  test("apaga um atendimento, libera o horário e remove o cliente que ficou sem agendamentos", async () => {
    const { json: a } = await manual(admin, { barbeiroId: 2, telefone: "62977771111", nome: "Para Apagar" });
    const r = await s.req("DELETE", `/api/admin/agendamentos/${a.id}`, { cookie: admin, corpo: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.id, a.id);
    assert.deepEqual(await doDia("2026-11-19"), []);
    assert.equal(await s.db.um("SELECT 1 FROM clientes WHERE telefone = '62977771111'"), null);
    assert.equal((await manual(admin, { barbeiroId: 2 })).status, 201, "o horário volta a ficar livre");
    assert.equal((await s.req("DELETE", `/api/admin/agendamentos/${a.id}`, { cookie: admin, corpo: {} })).status, 404);
  });

  test("barbeiro só apaga os próprios", async () => {
    const [deOutro] = await doDia("2026-11-19"); // do Kaua (barbeiro 2)
    assert.equal((await s.req("DELETE", `/api/admin/agendamentos/${deOutro.id}`, { cookie: marcio, corpo: {} })).status, 403);
    const { json: meu } = await manual(marcio, { hora: "11:00" });
    assert.equal((await s.req("DELETE", `/api/admin/agendamentos/${meu.id}`, { cookie: marcio, corpo: {} })).status, 200);
  });

  test("apagar cancelados limpa só os cancelados do período (e só os do barbeiro, se for barbeiro)", async () => {
    const criar = async (cookie, extra) => (await manual(cookie, { data: "2026-11-24", ...extra })).json;
    const cancelar = (a) => s.req("PATCH", `/api/admin/agendamentos/${a.id}`, { cookie: admin, corpo: { status: "cancelado" } });
    const doKaua = await criar(admin, { barbeiroId: 2, hora: "09:00" });
    const doMarcio = await criar(marcio, { hora: "09:00" });
    const ativo = await criar(admin, { barbeiroId: 3, hora: "09:00" });
    const outroDia = await criar(admin, { barbeiroId: 2, data: "2026-11-25" });
    for (const a of [doKaua, doMarcio, outroDia]) await cancelar(a);

    const doBarbeiro = await s.req("DELETE", "/api/admin/agendamentos?inicio=2026-11-24&fim=2026-11-24", { cookie: marcio, corpo: {} });
    assert.equal(doBarbeiro.json.apagados, 1);
    const tudo = await s.req("DELETE", "/api/admin/agendamentos?inicio=2026-11-24&fim=2026-11-24", { cookie: admin, corpo: {} });
    assert.equal(tudo.json.apagados, 1);
    assert.deepEqual((await doDia("2026-11-24")).map((a) => a.id), [ativo.id]);
    assert.equal((await doDia("2026-11-25")).length, 1, "outros dias ficam como estão");
    const invalido = await s.req("DELETE", "/api/admin/agendamentos?inicio=x&fim=y", { cookie: admin, corpo: {} });
    assert.equal(invalido.status, 422);
  });
});
