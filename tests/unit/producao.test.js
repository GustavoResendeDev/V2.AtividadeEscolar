/* Peças que só rodam na Cloudflare: cabeçalhos das páginas (public/_headers), e-mail de aviso e login. */
const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CABECALHOS_SEGURANCA } = require("../../server/app");
const { montarAviso, enviarAviso } = require("../../server/email");
const { criarAuth } = require("../../server/auth");
const { bancoDeTeste, SENHA } = require("../apoio/ambiente");

const agendamento = {
  codigo: "3F9A01BC",
  data: "2026-11-21",
  hora: "14:00",
  termino: "15:30",
  preco: 75,
  cliente: { nome: "Pedro <Alves>", telefone: "(62) 98888-1111" },
  servico: { nome: "Corte Masculino, Barba Tradicional / Modelada", quantidade: 2 },
  barbeiro: { nome: "Marcio Rocha" },
};

describe("Cloudflare", () => {
  test("public/_headers tem os mesmos cabeçalhos de segurança da API", () => {
    const arquivo = fs.readFileSync(path.join(__dirname, "../../public/_headers"), "utf8");
    for (const [nome, valor] of Object.entries(CABECALHOS_SEGURANCA)) {
      assert.ok(arquivo.includes(`  ${nome}: ${valor}\n`), `${nome} diferente em public/_headers`);
    }
  });
});

describe("E-mail de aviso (Resend)", () => {
  test("monta assunto e corpo com os dados do agendamento, escapando HTML", () => {
    const { assunto, texto, html } = montarAviso(agendamento, { urlPainel: "https://x.dev/admin/painel.html" });
    assert.equal(assunto, "Novo agendamento: Pedro <Alves>, 21/11 às 14:00");
    assert.match(texto, /Serviços: Corte Masculino, Barba Tradicional/);
    assert.match(texto, /Valor: R\$ 75,00/);
    assert.match(html, /Pedro &lt;Alves&gt;/);
    assert.ok(!html.includes("<Alves>"));
  });

  test("sem chave configurada, não envia nada", async () => {
    let chamou = false;
    const enviado = await enviarAviso({}, agendamento, { fetch: () => (chamou = true) });
    assert.equal(enviado, false);
    assert.equal(chamou, false);
  });

  test("envia para a API do Resend com a chave e os destinatários", async () => {
    let pedido;
    const env = { RESEND_API_KEY: "re_teste", EMAIL_AVISO_PARA: "a@x.com, b@x.com" };
    await enviarAviso(env, agendamento, {
      fetch: async (url, opcoes) => ((pedido = { url, ...opcoes, corpo: JSON.parse(opcoes.body) }), new Response("{}")),
    });
    assert.equal(pedido.url, "https://api.resend.com/emails");
    assert.equal(pedido.headers.Authorization, "Bearer re_teste");
    assert.deepEqual(pedido.corpo.to, ["a@x.com", "b@x.com"]);
    assert.match(pedido.corpo.from, /onboarding@resend\.dev/);
  });

  test("erro do Resend vira exceção (o Worker registra no log)", async () => {
    const env = { RESEND_API_KEY: "re_teste", EMAIL_AVISO_PARA: "a@x.com" };
    await assert.rejects(enviarAviso(env, agendamento, { fetch: async () => new Response("ruim", { status: 403 }) }), /403/);
  });
});

describe("Login com bcrypt no banco", () => {
  let db;
  after(() => db?.fechar());

  test("confere a senha, ignora maiúsculas no e-mail e não revela se o e-mail existe", async () => {
    db = await bancoDeTeste({ barbeiro: false });
    const auth = criarAuth(db);
    const ok = await auth.entrar("ADMIN@teste.com", SENHA);
    assert.equal(ok.usuario.email, "admin@teste.com");
    assert.equal(ok.usuario.senha_hash, undefined);
    assert.match(ok.cookie, /^sessao=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict/);
    assert.equal(await auth.entrar("admin@teste.com", "errada"), null);
    assert.equal(await auth.entrar("ninguem@teste.com", SENHA), null);
    const { senha_hash } = await db.um("SELECT senha_hash FROM usuarios WHERE email = 'admin@teste.com'");
    assert.match(senha_hash, /^\$2a\$10\$/);
    assert.equal(await auth.usuarioDaSessao(ok.cookie.split(";")[0]).then((u) => u.email), "admin@teste.com");
  });
});

describe("Migração de um banco antigo", () => {
  let db;
  after(() => db?.fechar());

  test("renomeia a equipe de exemplo, acrescenta a Sobrancelha e não duplica ao rodar de novo", async () => {
    const { bancoLocal, lerSchema } = require("../../server/banco-local");
    db = await bancoLocal();
    // Simula o banco como estava na primeira publicação.
    await db.query("DELETE FROM servicos WHERE nome = 'Sobrancelha'");
    await db.query(`UPDATE barbeiros SET nome = CASE id WHEN 1 THEN 'Rafael Moura' WHEN 2 THEN 'Thiago Brandão' ELSE 'Caio Henrique' END`);
    await db.executarScript(lerSchema());
    await db.executarScript(lerSchema());
    const barbeiros = await db.query("SELECT id, nome FROM barbeiros ORDER BY id");
    assert.deepEqual(barbeiros.map((b) => `${b.id}:${b.nome}`), ["1:Marcio Rocha", "2:Kaua", "3:Felipe"]);
    const { n } = await db.um("SELECT COUNT(*)::int AS n FROM servicos WHERE nome = 'Sobrancelha'");
    assert.equal(n, 1);
  });
});
