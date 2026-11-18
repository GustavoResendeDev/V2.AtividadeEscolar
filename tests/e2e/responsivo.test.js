/* Responsividade: as 6 telas (incluindo a página 404), em celulares, tablets e desktops, não podem ter rolagem lateral,
   e os botões e campos principais precisam ter área de toque de pelo menos 44px no celular. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
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

const APARELHOS = [
  { nome: "iPhone SE (1ª geração)", largura: 320, altura: 568, celular: true },
  { nome: "Android comum", largura: 360, altura: 740, celular: true },
  { nome: "iPhone 14", largura: 390, altura: 844, celular: true },
  { nome: "iPhone Pro Max", largura: 430, altura: 932, celular: true },
  { nome: "Celular deitado", largura: 740, altura: 360, celular: true },
  { nome: "iPad retrato", largura: 768, altura: 1024, toque: true },
  { nome: "iPad paisagem", largura: 1024, altura: 768, toque: true },
  { nome: "Notebook", largura: 1280, altura: 720 },
  { nome: "Full HD", largura: 1920, altura: 1080 },
];

const PAGINAS = ["/", "/agendamento.html", "/privacidade.html", "/admin/", "/admin/painel.html", "/pagina-que-nao-existe"];

let servidor, base, navegador, db, cookieSessao;

before(async () => {
  if (!playwright) return;
  db = abrirBanco(":memory:");
  criarUsuario(db, { nome: "Admin", email: "admin@teste.com", senha: SENHA, papel: "admin" });
  const app = criarApp({ db, log: logMudo });
  servidor = await new Promise((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${servidor.address().port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@teste.com", senha: SENHA }),
  });
  const [nome, valor] = login.headers.get("set-cookie").split(";")[0].split("=");
  cookieSessao = { name: nome, value: valor, url: base };
  navegador = await playwright.chromium.launch();
});

after(async () => {
  await navegador?.close();
  await new Promise((ok) => (servidor ? servidor.close(ok) : ok()));
  db?.close();
});

for (const aparelho of APARELHOS) {
  test(`sem rolagem lateral: ${aparelho.nome} (${aparelho.largura}x${aparelho.altura})`, { skip: !playwright && "Playwright não instalado" }, async () => {
    const contexto = await navegador.newContext({
      viewport: { width: aparelho.largura, height: aparelho.altura },
      isMobile: Boolean(aparelho.celular),
      hasTouch: Boolean(aparelho.celular || aparelho.toque),
      locale: "pt-BR",
    });
    const pagina = await contexto.newPage();
    for (const caminho of PAGINAS) {
      if (caminho === "/admin/painel.html") await contexto.addCookies([cookieSessao]);
      await pagina.goto(base + caminho);
      await pagina.waitForLoadState("networkidle");
      const medida = await pagina.evaluate(() => ({
        documento: document.documentElement.scrollWidth,
        janela: document.documentElement.clientWidth,
        visual: window.innerWidth,
      }));
      assert.ok(medida.documento <= medida.janela, `${caminho}: conteúdo com ${medida.documento}px numa tela de ${medida.janela}px`);
      // Num celular, a página não pode ser "encolhida" pelo navegador para caber.
      assert.equal(medida.visual, aparelho.largura, `${caminho}: o navegador reduziu o zoom da página`);
    }
    await contexto.close();
  });
}

test("alvos de toque de pelo menos 44px no celular", { skip: !playwright && "Playwright não instalado" }, async () => {
  const contexto = await navegador.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await contexto.addCookies([cookieSessao]);
  const pagina = await contexto.newPage();
  const verificar = async (caminho, seletor) => {
    await pagina.goto(base + caminho);
    await pagina.waitForLoadState("networkidle");
    const pequenos = await pagina.$$eval(seletor, (els) =>
      els
        .map((e) => ({ texto: (e.textContent || e.getAttribute("aria-label") || e.id).trim(), altura: e.getBoundingClientRect().height }))
        .filter((e) => e.altura > 0 && e.altura < 44)
    );
    assert.deepEqual(pequenos, [], `${caminho} ${seletor}`);
  };
  await verificar("/", "header .menu a, .botao, .ponto, .rodapeLinks a");
  await verificar(
    "/agendamento.html",
    ".campo input:not([type=checkbox]):not([type=radio]), .campo select, .atalhoData, .opcaoServico, .opcaoBarbeiro, .botao"
  );
  await verificar("/admin/painel.html", ".botao, .entradaPainel, .filtrosPainel select");
  await verificar("/pagina-que-nao-existe", ".numeroErro");
  await contexto.close();
});

test("menu do celular: abre no botão, ocupa uma linha só e fecha ao escolher um item", { skip: !playwright && "Playwright não instalado" }, async () => {
  const contexto = await navegador.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const pagina = await contexto.newPage();
  await pagina.goto(base + "/");
  await pagina.waitForLoadState("networkidle");

  // Logo, Agendar e botão de menu na mesma linha; os links começam escondidos.
  const altura = await pagina.evaluate(() => document.querySelector("header").getBoundingClientRect().height);
  assert.ok(altura < 90, `cabeçalho com ${altura}px: deveria ter uma linha só`);
  assert.equal(await pagina.isVisible("#menuPrincipal a[href='#servicos']"), false);

  await pagina.click(".botaoMenu");
  assert.equal(await pagina.getAttribute(".botaoMenu", "aria-expanded"), "true");
  const link = pagina.locator("#menuPrincipal a[href='#servicos']");
  await link.waitFor({ state: "visible" });
  assert.ok((await link.boundingBox()).height >= 44, "item do menu com área de toque de 44px");

  await link.click();
  assert.equal(await pagina.getAttribute(".botaoMenu", "aria-expanded"), "false");
  await pagina.waitForFunction(() => window.scrollY > 300);

  // Esc também fecha e devolve o foco ao botão.
  await pagina.click(".botaoMenu");
  await pagina.keyboard.press("Escape");
  assert.equal(await pagina.getAttribute(".botaoMenu", "aria-expanded"), "false");
  assert.equal(await pagina.evaluate(() => document.activeElement.classList.contains("botaoMenu")), true);
  await contexto.close();
});
