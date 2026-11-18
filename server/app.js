/* Aplicação web: entrega as páginas (pasta public/) e a API REST em /api. */
const path = require("node:path");
const express = require("express");
const { criarAuth, criarLimitador } = require("./auth");
const { criarAgenda, ErroNegocio } = require("./agenda");

const PASTA_PUBLICA = path.join(__dirname, "..", "public");
const WHATSAPP_BARBEARIA = "5562993548184";

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

function formatarDataBR(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const semana = data.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  return `${semana}, ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

// Mensagem que o cliente envia à barbearia, no formato do WhatsApp (*negrito*, _itálico_).
function mensagemParaBarbearia(a) {
  return [
    "*NOVO AGENDAMENTO* ✂️",
    "_Nova Era Barbearia_",
    "",
    `🔖 *Código:* ${a.codigo}`,
    `👤 *Cliente:* ${a.cliente.nome}`,
    `💈 *Serviço:* ${a.servico.nome}`,
    `💰 *Valor:* R$ ${a.preco.toFixed(2).replace(".", ",")}`,
    `📅 *Data:* ${formatarDataBR(a.data)}`,
    `⏰ *Horário:* ${a.hora} às ${a.termino}`,
    `🧔 *Barbeiro:* ${a.barbeiro.nome}`,
    "",
    "Aguardo a confirmação. Obrigado!",
    "",
    "_Enviado pelo site. Dados tratados conforme a Política de Privacidade (LGPD)._",
  ].join("\n");
}

const linkWhatsapp = (numero, texto) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;

function criarApp({ db, producao = false, agora = () => new Date(), log = console } = {}) {
  const app = express();
  const agenda = criarAgenda(db, { agora });
  const auth = criarAuth(db, { producao, agora: () => agora().getTime() });
  const limitador = criarLimitador({ agora: () => agora().getTime() });

  app.disable("x-powered-by");
  if (producao) app.set("trust proxy", 1);

  // Cabeçalhos de segurança em todas as respostas.
  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (producao) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: "10kb" }));
  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    // Escritas só aceitam JSON: um formulário de outro site não consegue enviar JSON sem CORS.
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ erro: "Envie os dados em JSON." });
    next();
  });

  // ---------- Rotas públicas ----------
  api.get("/saude", (req, res) => res.json({ ok: true }));

  api.get("/servicos", (req, res) => res.json(agenda.listarServicos()));

  api.get("/barbeiros", (req, res) => res.json(agenda.listarBarbeiros()));

  api.get("/disponibilidade", (req, res) => {
    const { data, servico, barbeiro } = req.query;
    res.json({
      data,
      horarios: agenda.disponibilidade({ data, servicoId: servico, barbeiroId: barbeiro || null }),
    });
  });

  api.post("/agendamentos", (req, res) => {
    const b = req.body || {};
    const agendamento = agenda.criarAgendamento({
      nome: b.nome,
      telefone: b.telefone,
      servicoId: b.servicoId,
      barbeiroId: b.barbeiroId || null,
      data: b.data,
      hora: b.hora,
      consentimento: b.consentimento,
    });
    log.info?.(`Agendamento ${agendamento.codigo} criado para ${agendamento.data} ${agendamento.hora}.`);
    res.status(201).json({
      codigo: agendamento.codigo,
      data: agendamento.data,
      hora: agendamento.hora,
      termino: agendamento.termino,
      preco: agendamento.preco,
      servico: agendamento.servico.nome,
      barbeiro: agendamento.barbeiro.nome,
      whatsapp: linkWhatsapp(WHATSAPP_BARBEARIA, mensagemParaBarbearia(agendamento)),
    });
  });

  // ---------- Painel (exige login) ----------
  api.post("/admin/login", (req, res) => {
    const chave = req.ip;
    const espera = limitador.bloqueado(chave);
    if (espera) {
      res.setHeader("Retry-After", String(espera));
      return res.status(429).json({ erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." });
    }
    const usuario = auth.entrar(res, req.body?.email, req.body?.senha);
    if (!usuario) {
      limitador.falhou(chave);
      return res.status(401).json({ erro: "E-mail ou senha incorretos." });
    }
    limitador.limpar(chave);
    res.json(usuario);
  });

  // Consulta de sessão sem erro: o login usa para saber se já pode ir direto à agenda.
  api.get("/sessao", (req, res) => res.json({ usuario: auth.usuarioDaSessao(req) }));

  api.post("/admin/logout", (req, res) => {
    auth.sair(req, res);
    res.status(204).end();
  });

  api.use("/admin", auth.exigirLogin);

  // Barbeiro vê só a própria agenda; administrador vê todas (e pode filtrar).
  const barbeiroDoFiltro = (req) =>
    req.usuario.papel === "barbeiro" ? req.usuario.barbeiro_id : req.query.barbeiro || null;

  api.get("/admin/me", (req, res) => res.json(req.usuario));

  api.get("/admin/agendamentos", (req, res) => {
    const filtro = { data: req.query.data, barbeiroId: barbeiroDoFiltro(req) };
    res.json({
      agendamentos: agenda.listar({ ...filtro, status: req.query.status || null }),
      resumo: agenda.resumo(filtro),
    });
  });

  api.patch("/admin/agendamentos/:id", (req, res) => {
    res.json(agenda.mudarStatus(req.params.id, req.body?.status, req.usuario));
  });

  api.use((req, res) => res.status(404).json({ erro: "Rota não encontrada." }));

  app.use("/api", api);

  app.use(
    express.static(PASTA_PUBLICA, {
      extensions: ["html"],
      setHeaders(res, caminho) {
        if (/\.(webp|png|woff2|mp4)$/.test(caminho)) res.setHeader("Cache-Control", "public, max-age=604800");
      },
    })
  );

  app.use((req, res) => res.status(404).sendFile(path.join(PASTA_PUBLICA, "404.html")));

  // Erros: regras de negócio viram mensagens claras; o resto vira 500 sem detalhes internos.
  // eslint-disable-next-line no-unused-vars
  app.use((erro, req, res, next) => {
    if (erro instanceof ErroNegocio) return res.status(erro.status).json({ erro: erro.message, campo: erro.campo });
    if (erro.type === "entity.parse.failed") return res.status(400).json({ erro: "JSON inválido." });
    if (erro.type === "entity.too.large") return res.status(413).json({ erro: "Dados grandes demais." });
    log.error?.(erro);
    res.status(500).json({ erro: "Erro interno. Tente novamente em instantes." });
  });

  return app;
}

module.exports = { criarApp, mensagemParaBarbearia };
