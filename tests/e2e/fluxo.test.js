/* Teste de ponta a ponta: um cliente agenda pelo site e o barbeiro confirma no painel,
   num navegador de verdade (Chromium via Playwright).
   Requer: npm i -D playwright && npx playwright install chromium */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const regras = require("../../public/js/regras.js");
const { abrirBanco } = require("../../server/db");
const { criarApp } = require("../../server/app");
const { criarUsuario } = require("../../server/usuarios");
const { logMudo, SENHA } = require("../apoio/ambiente");

let playwright = null;
try {
  playwright = require("playwright");
} catch {
  /* sem Playwright instalado: os testes são pulados */
}

// Próximo dia útil a pelo menos 2 dias de hoje.
function proximoDiaAberto() {
  let data = regras.somarDias(regras.hojeISO(), 2);
  while (regras.motivoDataFechada(data)) data = regras.somarDias(data, 1);
  return data;
}

let servidor, base, navegador, db;
const DATA = proximoDiaAberto();

before(async () => {
  if (!playwright) return;
  db = abrirBanco(":memory:");
  criarUsuario(db, { nome: "Admin", email: "admin@teste.com", senha: SENHA, papel: "admin" });
  const app = criarApp({ db, log: logMudo });
  servidor = await new Promise((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${servidor.address().port}`;
  navegador = await playwright.chromium.launch();
});

after(async () => {
  await navegador?.close();
  await new Promise((ok) => (servidor ? servidor.close(ok) : ok()));
  db?.close();
});

test("cliente agenda e o barbeiro confirma no painel", { skip: !playwright && "Playwright não instalado" }, async () => {
  const pagina = await navegador.newPage({ locale: "pt-BR" });
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(e.message));
  pagina.on("console", (m) => m.type() === "error" && erros.push(m.text()));

  // 1. Cliente: formulário de agendamento
  await pagina.goto(`${base}/agendamento.html`);
  await pagina.selectOption("#servico", { label: "Corte Masculino · 1h · R$ 40,00" });
  await pagina.locator(".opcaoBarbeiro", { hasText: "Caio Henrique" }).click();
  await pagina.fill("#data", DATA);
  await pagina.dispatchEvent("#data", "change");
  await pagina.waitForFunction(() => !document.querySelector("#hora").disabled);
  await pagina.selectOption("#hora", "15:00");
  await pagina.fill("#nome", "Lucas Ferreira");
  await pagina.fill("#telefone", "62987654321");
  assert.equal(await pagina.inputValue("#telefone"), "(62) 98765-4321", "máscara do telefone");
  await pagina.locator(".consentimento").click();
  await pagina.click(".botaoEnviar");

  await pagina.waitForSelector("#confirmacao:not([hidden])");
  const resumo = await pagina.textContent(".resumo");
  assert.match(resumo, /Caio Henrique/);
  assert.match(resumo, /15:00 às 16:00/);
  assert.match(await pagina.getAttribute("#abrirWhatsapp", "href"), /^https:\/\/wa\.me\/5562993548184\?text=/);

  // 2. O mesmo horário não aparece mais como livre
  await pagina.click("#novoAgendamento");
  await pagina.selectOption("#servico", { label: "Corte Masculino · 1h · R$ 40,00" });
  await pagina.locator(".opcaoBarbeiro", { hasText: "Caio Henrique" }).click();
  await pagina.fill("#data", DATA);
  await pagina.dispatchEvent("#data", "change");
  await pagina.waitForFunction(() => !document.querySelector("#hora").disabled);
  const horas = await pagina.$$eval("#hora option", (os) => os.map((o) => o.value));
  assert.ok(!horas.includes("15:00"), "15:00 deveria estar ocupado");

  // 3. Barbeiro: login com senha errada e depois certa
  await pagina.goto(`${base}/admin/`);
  await pagina.fill("#email", "admin@teste.com");
  await pagina.fill("#senha", "senha-errada");
  await pagina.click(".botaoEnviar");
  await pagina.waitForSelector("#erroLogin:not([hidden])");
  await pagina.fill("#senha", SENHA);
  await pagina.click(".botaoEnviar");
  await pagina.waitForURL(/painel\.html/);

  // 4. Painel: encontra o atendimento e confirma
  await pagina.goto(`${base}/admin/painel.html?data=${DATA}`);
  const item = pagina.locator(".atendimento", { hasText: "Lucas Ferreira" });
  await item.waitFor();
  assert.equal(await item.getAttribute("data-status"), "pendente");
  await item.getByRole("button", { name: /Confirmar/ }).click();
  await pagina.waitForSelector('.atendimento[data-status="confirmado"]');
  assert.equal(await pagina.textContent("#indConfirmados"), "1");

  // 5. Sair encerra a sessão
  await pagina.click("#sair");
  await pagina.waitForURL(/admin\/(index\.html)?$/);

  // O 401 da senha errada é esperado; nenhum outro erro pode aparecer.
  const inesperados = erros.filter((e) => !/401/.test(e));
  assert.deepEqual(inesperados, []);
});
