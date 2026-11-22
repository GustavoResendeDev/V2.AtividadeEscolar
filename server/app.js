/* API REST em /api (Hono). Roda igual no Cloudflare Worker (produção) e no Node (npm start e testes).
   No Worker, as páginas de public/ são entregues direto pela Cloudflare (static assets) e só /api/*
   chega aqui; no Node, server/local.js acrescenta os arquivos estáticos. */
const { Hono } = require("hono");
const { criarAuth, criarLimitador } = require("./auth");
const { criarAgenda, ErroNegocio } = require("./agenda");

const WHATSAPP_BARBEARIA = "5562992002388";

// Os mesmos cabeçalhos estão em public/_headers, que a Cloudflare aplica às páginas (um teste confere).
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const CABECALHOS_SEGURANCA = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function formatarDataBR(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const semana = data.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  return `${semana}, ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

// Mensagem que o cliente envia à barbearia, no formato do WhatsApp (*negrito*, _itálico_).
function mensagemParaBarbearia(a) {
  return [
    "*NOVO AGENDAMENTO*",
    "_Nova Era Barbearia_",
    "",
    `*Código:* ${a.codigo}`,
    `*Cliente:* ${a.cliente.nome}`,
    `*${a.servico.quantidade > 1 ? "Serviços" : "Serviço"}:* ${a.servico.nome}`,
    `*Valor:* R$ ${a.preco.toFixed(2).replace(".", ",")}`,
    `*Data:* ${formatarDataBR(a.data)}`,
    `*Horário:* ${a.hora} às ${a.termino}`,
    `*Barbeiro:* ${a.barbeiro.nome}`,
    "",
    "Aguardo a confirmação. Obrigado!",
    "",
    "_Enviado pelo site. Dados tratados conforme a Política de Privacidade (LGPD)._",
  ].join("\n");
}

const linkWhatsapp = (numero, texto) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

const LIMITE_CORPO = 10 * 1024;

/**
 * @param banco    o banco (server/banco.js) ou uma função (c) => banco, para abrir um por requisição
 * @param aoCriarAgendamento  chamado depois de um agendamento pelo site (aviso por e-mail no Worker)
 * @param estaticos  só no Node: { servir: middleware, pagina404: html }
 */
function criarApp({
  banco,
  producao = false,
  agora = () => new Date(),
  log = console,
  aoCriarAgendamento = null,
  estaticos = null,
  ipDe = () => null,
  catalogo = undefined,
} = {}) {
  const app = new Hono();

  // Cabeçalhos de segurança em todas as respostas.
  app.use(async (c, next) => {
    await next();
    for (const [nome, valor] of Object.entries(CABECALHOS_SEGURANCA)) c.res.headers.set(nome, valor);
    if (producao) c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
  });

  // Erros: regras de negócio viram mensagens claras; o resto vira 500 sem detalhes internos.
  const tratarErro = (erro, c) => {
    if (erro instanceof ErroNegocio) return c.json({ erro: erro.message, campo: erro.campo }, erro.status);
    log.error?.(erro);
    return c.json({ erro: "Erro interno. Tente novamente em instantes." }, 500);
  };
  app.onError(tratarErro);

  const api = new Hono();
  api.onError(tratarErro);

  // Serviços por requisição (no Worker, cada requisição tem a própria conexão com o banco).
  api.use(async (c, next) => {
    const db = typeof banco === "function" ? banco(c) : banco;
    const relogioMs = () => agora().getTime();
    c.set("agenda", criarAgenda(db, { agora, catalogo }));
    c.set("auth", criarAuth(db, { producao, agora: relogioMs }));
    c.set("limitador", criarLimitador(db, { agora: relogioMs }));

    // Escritas só aceitam JSON: um formulário de outro site não consegue enviar JSON sem CORS.
    if (!["GET", "HEAD"].includes(c.req.method)) {
      if (!/^application\/json\b/i.test(c.req.header("content-type") || ""))
        return c.json({ erro: "Envie os dados em JSON." }, 415, { "Cache-Control": "no-store" });
      const texto = await c.req.text();
      if (texto.length > LIMITE_CORPO) return c.json({ erro: "Dados grandes demais." }, 413);
      try {
        const corpo = texto ? JSON.parse(texto) : {};
        c.set("corpo", corpo && typeof corpo === "object" ? corpo : {});
      } catch {
        return c.json({ erro: "JSON inválido." }, 400, { "Cache-Control": "no-store" });
      }
    }
    await next();
    if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  });

  // Catálogo público: o navegador reaproveita por 5 min e atualiza em segundo plano depois disso.
  const CACHE_CATALOGO = { "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" };

  // ---------- Rotas públicas ----------
  api.get("/saude", (c) => c.json({ ok: true }));

  api.get("/servicos", async (c) => c.json(await c.get("agenda").listarServicos(), 200, CACHE_CATALOGO));

  api.get("/barbeiros", async (c) => c.json(await c.get("agenda").listarBarbeiros(), 200, CACHE_CATALOGO));

  api.get("/disponibilidade", async (c) => {
    // ?servicos=1,7 (vários) ou ?servico=1 (um só)
    const { data, servico, servicos, barbeiro } = c.req.query();
    const servicoIds = servicos ? String(servicos).split(",") : null;
    const horarios = await c
      .get("agenda")
      .disponibilidade({ data, servicoId: servico, servicoIds, barbeiroId: barbeiro || null });
    return c.json({ data, horarios });
  });

  api.post("/agendamentos", async (c) => {
    const b = c.get("corpo");
    const agendamento = await c.get("agenda").criarAgendamento({
      nome: b.nome,
      telefone: b.telefone,
      servicoId: b.servicoId,
      servicoIds: b.servicoIds,
      barbeiroId: b.barbeiroId || null,
      data: b.data,
      hora: b.hora,
      consentimento: b.consentimento,
    });
    log.info?.(`Agendamento ${agendamento.codigo} criado para ${agendamento.data} ${agendamento.hora}.`);
    if (aoCriarAgendamento) aoCriarAgendamento(agendamento, c);
    return c.json(
      {
        codigo: agendamento.codigo,
        data: agendamento.data,
        hora: agendamento.hora,
        termino: agendamento.termino,
        preco: agendamento.preco,
        servico: agendamento.servico.nome,
        barbeiro: agendamento.barbeiro.nome,
        whatsapp: linkWhatsapp(WHATSAPP_BARBEARIA, mensagemParaBarbearia(agendamento)),
      },
      201
    );
  });

  // ---------- Painel (exige login) ----------
  api.post("/admin/login", async (c) => {
    const limitador = c.get("limitador");
    const chave = c.req.header("cf-connecting-ip") || ipDe(c) || "local";
    const espera = await limitador.bloqueado(chave);
    if (espera)
      return c.json({ erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." }, 429, {
        "Retry-After": String(espera),
      });
    const corpo = c.get("corpo");
    const sessao = await c.get("auth").entrar(corpo.email, corpo.senha);
    if (!sessao) {
      await limitador.falhou(chave);
      return c.json({ erro: "E-mail ou senha incorretos." }, 401);
    }
    await limitador.limpar(chave);
    return c.json(sessao.usuario, 200, { "Set-Cookie": sessao.cookie });
  });

  // Consulta de sessão sem erro: o login usa para saber se já pode ir direto à agenda.
  api.get("/sessao", async (c) => c.json({ usuario: await c.get("auth").usuarioDaSessao(c.req.header("cookie")) }));

  api.post("/admin/logout", async (c) => {
    const cookie = await c.get("auth").sair(c.req.header("cookie"));
    return c.body(null, 204, { "Set-Cookie": cookie });
  });

  api.use("/admin/*", async (c, next) => {
    const usuario = await c.get("auth").usuarioDaSessao(c.req.header("cookie"));
    if (!usuario) return c.json({ erro: "Faça login para continuar." }, 401);
    c.set("usuario", usuario);
    await next();
  });

  // Barbeiro vê só a própria agenda; administrador vê todas (e pode filtrar).
  const barbeiroDoFiltro = (c) => {
    const usuario = c.get("usuario");
    return usuario.papel === "barbeiro" ? usuario.barbeiro_id : c.req.query("barbeiro") || null;
  };

  api.get("/admin/me", (c) => c.json(c.get("usuario")));

  // Lista de um dia (?data=) ou de um período (?inicio=&fim=), com o resumo do mesmo recorte.
  api.get("/admin/agendamentos", async (c) => {
    const agenda = c.get("agenda");
    const { data, inicio, fim, status } = c.req.query();
    const filtro = { data, inicio, fim, barbeiroId: barbeiroDoFiltro(c) };
    const todos = await agenda.listar(filtro);
    const agendamentos = status ? await agenda.listar({ ...filtro, status }) : todos;
    return c.json({ agendamentos, resumo: agenda.resumoDe(todos) });
  });

  // Agendamento manual feito pela equipe.
  api.post("/admin/agendamentos", async (c) => {
    const b = c.get("corpo");
    const usuario = c.get("usuario");
    const criado = await c.get("agenda").criarManual(
      {
        nome: b.nome,
        telefone: b.telefone,
        servicoId: b.servicoId,
        servicoIds: b.servicoIds,
        barbeiroId: b.barbeiroId || null,
        data: b.data,
        hora: b.hora,
        status: b.status,
      },
      usuario
    );
    log.info?.(`Agendamento manual ${criado.codigo} para ${criado.data} ${criado.hora} (usuário ${usuario.id}).`);
    return c.json(criado, 201);
  });

  api.patch("/admin/agendamentos/:id", async (c) =>
    c.json(await c.get("agenda").mudarStatus(c.req.param("id"), c.get("corpo").status, c.get("usuario")))
  );

  // Remarcação: arrastar o atendimento para outra data, horário ou barbeiro.
  api.patch("/admin/agendamentos/:id/horario", async (c) => {
    const b = c.get("corpo");
    const destino = { data: b.data, hora: b.hora, barbeiroId: b.barbeiroId };
    return c.json(await c.get("agenda").remarcar(c.req.param("id"), destino, c.get("usuario")));
  });

  // Apagar um atendimento de vez.
  api.delete("/admin/agendamentos/:id", async (c) => {
    const usuario = c.get("usuario");
    const r = await c.get("agenda").excluir(c.req.param("id"), usuario);
    log.info?.(`Agendamento ${r.id} apagado (usuário ${usuario.id}).`);
    return c.json(r);
  });

  // Limpeza: apaga os cancelados do período (?inicio=&fim=). Barbeiro: só os próprios.
  api.delete("/admin/agendamentos", async (c) => {
    const { inicio, fim } = c.req.query();
    const r = await c.get("agenda").excluirCancelados({ inicio, fim, barbeiroId: barbeiroDoFiltro(c) });
    log.info?.(`${r.apagados} cancelado(s) apagado(s) de ${inicio} a ${fim} (usuário ${c.get("usuario").id}).`);
    return c.json(r);
  });

  // Quantas pessoas cada barbeiro atendeu no período.
  api.get("/admin/relatorio", async (c) => {
    const { inicio, fim } = c.req.query();
    return c.json(await c.get("agenda").relatorio({ inicio, fim, barbeiroId: barbeiroDoFiltro(c) }));
  });

  api.all("*", (c) => c.json({ erro: "Rota não encontrada." }, 404));

  app.route("/api", api);

  if (estaticos) {
    app.use("*", estaticos.servir);
    app.notFound((c) => c.html(estaticos.pagina404, 404));
  }

  return app;
}

module.exports = { criarApp, mensagemParaBarbearia, CABECALHOS_SEGURANCA };
