/* Modo demonstração para o GitHub Pages (hospedagem só de arquivos estáticos).
   O Pages não roda o servidor Node nem o banco SQLite, então este arquivo responde às
   chamadas /api/... dentro do próprio navegador, com as MESMAS regras do servidor
   (server/agenda.js) e os dados salvos no localStorage de quem está usando.
   Só é incluído na versão publicada no Pages (ver pages/build.mjs); o sistema
   completo com banco de dados continua sendo o do Render/Docker. */
(function () {
  "use strict";

  const CHAVE = "novaera-demo-v1";
  const WHATSAPP_BARBEARIA = "5562992002388";
  const SENHA_DEMO = "novaera2026";
  const R = () => self; // funções de public/js/regras.js (carregado nas páginas que usam agenda)

  const STATUS_OCUPAM = ["pendente", "confirmado", "concluido", "faltou"];
  const TRANSICOES = {
    pendente: ["confirmado", "cancelado"],
    confirmado: ["concluido", "faltou", "cancelado"],
    concluido: [],
    cancelado: [],
    faltou: [],
  };

  const BARBEIROS = [
    { id: 1, nome: "Marcio Rocha", especialidade: "Barbeiro e administrador" },
    { id: 2, nome: "Kaua", especialidade: "Barbeiro" },
    { id: 3, nome: "Felipe", especialidade: "Barbeiro" },
  ];
  const SERVICOS = [
    ["Corte Masculino", "Cabelo", 60, 4000],
    ["Corte e Barba", "Cabelo", 60, 7500],
    ["Camuflagem de Cabelos Brancos", "Cabelo", 140, 12000],
    ["Coloração / Tonalização", "Cabelo", 120, 12000],
    ["Hidratação", "Cabelo", 30, 3000],
    ["Higienização + Secagem", "Cabelo", 20, 2000],
    ["Barba Tradicional / Modelada", "Barba e Bigode", 30, 3500],
    ["Barba com Máquina", "Barba e Bigode", 30, 3500],
    ["Bigode Modelado", "Barba e Bigode", 30, 3500],
    ["Sobrancelha", "Barba e Bigode", 15, 1500],
  ].map(([nome, categoria, duracao_min, preco_centavos], i) => ({ id: i + 1, nome, categoria, duracao_min, preco_centavos }));
  const USUARIOS = [
    { id: 1, nome: "Administrador", email: "admin@novaera.com.br", papel: "admin", barbeiro_id: null },
    { id: 2, nome: "Marcio Rocha", email: "marcio@novaera.com.br", papel: "barbeiro", barbeiro_id: 1 },
    { id: 3, nome: "Kaua", email: "kaua@novaera.com.br", papel: "barbeiro", barbeiro_id: 2 },
    { id: 4, nome: "Felipe", email: "felipe@novaera.com.br", papel: "barbeiro", barbeiro_id: 3 },
  ];

  // ---------- Armazenamento (localStorage, com memória como reserva) ----------
  let memoria = null;
  function carregar() {
    if (memoria) return memoria;
    try {
      memoria = JSON.parse(localStorage.getItem(CHAVE));
    } catch {
      memoria = null;
    }
    if (!memoria || !Array.isArray(memoria.agendamentos)) memoria = { agendamentos: [], proximoId: 1, sessao: null };
    return memoria;
  }
  function salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(memoria));
    } catch {
      /* navegação privada: os dados ficam só na memória desta aba */
    }
  }

  class ErroNegocio extends Error {
    constructor(status, mensagem, campo) {
      super(mensagem);
      this.status = status;
      this.campo = campo;
    }
  }

  const servicoAtivo = (id) => SERVICOS.find((s) => s.id === Number(id)) || null;
  const barbeiroAtivo = (id) => BARBEIROS.find((b) => b.id === Number(id)) || null;

  function normalizarTelefone(valor) {
    let d = String(valor || "").replace(/\D/g, "");
    if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
    return /^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(d) ? d : null;
  }
  function formatarTelefone(d) {
    if (!d) return "";
    const n = d.slice(2);
    const corte = n.length === 9 ? 5 : 4;
    return `(${d.slice(0, 2)}) ${n.slice(0, corte)}-${n.slice(corte)}`;
  }

  function validarData(data) {
    const r = R();
    if (!r.dataValida(data)) throw new ErroNegocio(422, "Escolha uma data válida.", "data");
    const hoje = r.hojeISO();
    if (data < hoje) throw new ErroNegocio(422, "Escolha uma data a partir de hoje.", "data");
    const dias = r.FUNCIONAMENTO.antecedenciaMaximaDias;
    if (data > r.somarDias(hoje, dias)) throw new ErroNegocio(422, `Agendamos com até ${dias} dias de antecedência.`, "data");
    const motivo = r.motivoDataFechada(data);
    if (motivo) throw new ErroNegocio(422, motivo, "data");
  }

  const ocupacoes = (data, barbeiroId) =>
    carregar().agendamentos.filter((a) => a.data === data && a.barbeiro_id === barbeiroId && STATUS_OCUPAM.includes(a.status));
  const livre = (ocupados, ini, fim) => !ocupados.some((o) => R().sobrepoe(ini, fim, o.inicio_min, o.fim_min));
  const minutoMinimo = (data) => (data === R().hojeISO() ? R().agoraEmBrasilia().minutos + 1 : 0);

  const MAX_SERVICOS = 5;

  /* Lista de serviços do pedido (igual ao server/agenda.js): aceita servicoIds (vários)
     ou servicoId (um só) e devolve duração, preço e nomes somados. */
  function servicosDoPedido({ servicoIds, servicoId }) {
    let ids = Array.isArray(servicoIds) ? servicoIds : servicoId != null && servicoId !== "" ? [servicoId] : [];
    ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) throw new ErroNegocio(422, "Escolha pelo menos um serviço.", "servico");
    if (ids.length > MAX_SERVICOS)
      throw new ErroNegocio(422, `Escolha no máximo ${MAX_SERVICOS} serviços por agendamento.`, "servico");
    const lista = ids.map((id) => {
      const servico = servicoAtivo(id);
      if (!servico) throw new ErroNegocio(422, "Um dos serviços escolhidos não está disponível.", "servico");
      return servico;
    });
    const duracao = lista.reduce((t, s) => t + s.duracao_min, 0);
    const { abre, fecha } = R().FUNCIONAMENTO;
    if (duracao > fecha - abre)
      throw new ErroNegocio(422, "Os serviços escolhidos não cabem num mesmo dia. Divida em dois agendamentos.", "servico");
    return { lista, duracao, preco: lista.reduce((t, s) => t + s.preco_centavos, 0), nome: lista.map((s) => s.nome).join(", ") };
  }

  function disponibilidade({ data, servico: servicoId, servicos, barbeiro: barbeiroId }) {
    validarData(data);
    const { duracao } = servicosDoPedido({ servicoId, servicoIds: servicos ? String(servicos).split(",") : null });
    let barbeiros = BARBEIROS;
    if (barbeiroId) {
      const b = barbeiroAtivo(barbeiroId);
      if (!b) throw new ErroNegocio(422, "Escolha um barbeiro válido.", "barbeiro");
      barbeiros = [b];
    }
    const agendas = barbeiros.map((b) => ocupacoes(data, b.id));
    const minimo = minutoMinimo(data);
    return {
      data,
      horarios: R()
        .gradeDeHorarios(duracao)
        .filter((ini) => ini >= minimo)
        .map((ini) => ({ hora: R().paraHora(ini), disponivel: agendas.some((o) => livre(o, ini, ini + duracao)) })),
    };
  }

  function formatar(a) {
    const ids = a.servico_ids || [a.servico_id];
    const s = servicoAtivo(ids[0]);
    const b = barbeiroAtivo(a.barbeiro_id);
    return {
      id: a.id,
      codigo: a.codigo,
      data: a.data,
      hora: R().paraHora(a.inicio_min),
      termino: R().paraHora(a.fim_min),
      preco: a.preco_centavos / 100,
      status: a.status,
      cliente: { nome: a.cliente_nome, telefone: formatarTelefone(a.cliente_telefone), whatsapp: a.cliente_telefone ? `55${a.cliente_telefone}` : null },
      servico: { id: s.id, nome: ids.map((id) => servicoAtivo(id).nome).join(", "), quantidade: ids.length },
      barbeiro: { id: b.id, nome: b.nome },
      proximosStatus: TRANSICOES[a.status],
    };
  }

  function formatarDataBR(iso) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    const semana = new Date(Date.UTC(ano, mes - 1, dia)).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
    return `${semana}, ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
  }

  function criarAgendamento(p) {
    const r = R();
    const nome = String(p.nome || "").trim().replace(/\s+/g, " ");
    if (nome.length < 3) throw new ErroNegocio(422, "Informe seu nome (pelo menos 3 letras).", "nome");
    if (nome.length > 80) throw new ErroNegocio(422, "O nome pode ter no máximo 80 letras.", "nome");
    const telefone = normalizarTelefone(p.telefone);
    if (!telefone) throw new ErroNegocio(422, "Informe um WhatsApp válido, com DDD.", "telefone");
    if (p.consentimento !== true) throw new ErroNegocio(422, "Para agendar, aceite a Política de Privacidade.", "consentimento");
    const servicos = servicosDoPedido(p);
    validarData(p.data);
    const inicio = r.paraMinutos(p.hora);
    if (Number.isNaN(inicio)) throw new ErroNegocio(422, "Escolha um horário.", "hora");
    const fim = inicio + servicos.duracao;
    const { abre, fecha, intervaloGrade } = r.FUNCIONAMENTO;
    if (inicio < abre || (inicio - abre) % intervaloGrade !== 0)
      throw new ErroNegocio(422, "Esse horário está fora do nosso funcionamento.", "hora");
    if (fim > fecha)
      throw new ErroNegocio(422, "Os serviços escolhidos terminariam depois das 19h. Escolha um horário mais cedo.", "hora");
    if (inicio < minutoMinimo(p.data)) throw new ErroNegocio(422, "Esse horário já passou. Escolha outro.", "hora");

    let barbeiro = null;
    if (p.barbeiroId) {
      barbeiro = barbeiroAtivo(p.barbeiroId);
      if (!barbeiro) throw new ErroNegocio(422, "Escolha um barbeiro válido.", "barbeiro");
      if (!livre(ocupacoes(p.data, barbeiro.id), inicio, fim))
        throw new ErroNegocio(409, "Esse horário acabou de ser reservado. Escolha outro.", "hora");
    } else {
      barbeiro = BARBEIROS.map((b) => ({ ...b, ocupados: ocupacoes(p.data, b.id) }))
        .filter((b) => livre(b.ocupados, inicio, fim))
        .sort((a, b) => a.ocupados.length - b.ocupados.length || a.id - b.id)[0];
      if (!barbeiro) throw new ErroNegocio(409, "Nenhum barbeiro está livre nesse horário. Escolha outro.", "hora");
    }

    const banco = carregar();
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const registro = {
      id: banco.proximoId++,
      codigo: [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase(),
      cliente_nome: nome,
      cliente_telefone: telefone,
      servico_id: servicos.lista[0].id,
      servico_ids: servicos.lista.map((s) => s.id),
      barbeiro_id: barbeiro.id,
      data: p.data,
      inicio_min: inicio,
      fim_min: fim,
      preco_centavos: servicos.preco,
      status: "pendente",
    };
    banco.agendamentos.push(registro);
    salvar();

    const a = formatar(registro);
    const texto = [
      "*NOVO AGENDAMENTO*",
      "_Nova Era Barbearia_",
      "",
      `*Código:* ${a.codigo}`,
      `*Cliente:* ${nome}`,
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
    return {
      codigo: a.codigo,
      data: a.data,
      hora: a.hora,
      termino: a.termino,
      preco: a.preco,
      servico: a.servico.nome,
      barbeiro: a.barbeiro.nome,
      whatsapp: `https://wa.me/${WHATSAPP_BARBEARIA}?text=${encodeURIComponent(texto)}`,
    };
  }

  function listar({ data, barbeiroId, status }) {
    if (!R().dataValida(data)) throw new ErroNegocio(422, "Data inválida.", "data");
    if (status && !TRANSICOES[status]) throw new ErroNegocio(422, "Status inválido.", "status");
    return carregar()
      .agendamentos.filter(
        (a) => a.data === data && (!barbeiroId || a.barbeiro_id === Number(barbeiroId)) && (!status || a.status === status)
      )
      .sort((a, b) => a.inicio_min - b.inicio_min || barbeiroAtivo(a.barbeiro_id).nome.localeCompare(barbeiroAtivo(b.barbeiro_id).nome))
      .map(formatar);
  }

  function resumo(filtro) {
    const lista = listar(filtro);
    const contar = (s) => lista.filter((a) => a.status === s).length;
    const somar = (e) => lista.filter((a) => e.includes(a.status)).reduce((t, a) => t + a.preco, 0);
    return {
      total: lista.filter((a) => a.status !== "cancelado").length,
      pendentes: contar("pendente"),
      confirmados: contar("confirmado"),
      concluidos: contar("concluido"),
      cancelados: contar("cancelado"),
      faltas: contar("faltou"),
      faturamentoPrevisto: somar(["pendente", "confirmado", "concluido"]),
      faturamentoRealizado: somar(["concluido"]),
    };
  }

  function mudarStatus(id, novo, usuario) {
    const a = carregar().agendamentos.find((x) => x.id === Number(id));
    if (!a) throw new ErroNegocio(404, "Agendamento não encontrado.");
    if (usuario.papel === "barbeiro" && a.barbeiro_id !== usuario.barbeiro_id)
      throw new ErroNegocio(403, "Você só pode alterar os seus atendimentos.");
    if (!(TRANSICOES[a.status] || []).includes(novo))
      throw new ErroNegocio(422, `Não é possível passar de "${a.status}" para "${novo}".`, "status");
    a.status = novo;
    salvar();
    return formatar(a);
  }

  function excluir(id, usuario) {
    const lista = carregar().agendamentos;
    const i = lista.findIndex((x) => x.id === Number(id));
    if (i === -1) throw new ErroNegocio(404, "Agendamento não encontrado.");
    if (usuario.papel === "barbeiro" && lista[i].barbeiro_id !== usuario.barbeiro_id)
      throw new ErroNegocio(403, "Você só pode alterar os seus atendimentos.");
    lista.splice(i, 1);
    salvar();
    return { id: Number(id) };
  }

  function excluirCancelados(inicio, fim, barbeiroId) {
    const dados = carregar();
    const antes = dados.agendamentos.length;
    dados.agendamentos = dados.agendamentos.filter(
      (a) => !(a.status === "cancelado" && a.data >= inicio && a.data <= fim && (!barbeiroId || a.barbeiro_id === Number(barbeiroId)))
    );
    salvar();
    return { apagados: antes - dados.agendamentos.length };
  }

  const usuarioDaSessao = () => USUARIOS.find((u) => u.id === carregar().sessao) || null;

  // ---------- Roteador: mesmas rotas e respostas do server/app.js ----------
  function rotear(metodo, caminho, q, corpo) {
    if (metodo === "GET" && caminho === "/saude") return [200, { ok: true }];
    if (metodo === "GET" && caminho === "/servicos") return [200, SERVICOS];
    if (metodo === "GET" && caminho === "/barbeiros") return [200, BARBEIROS];
    if (metodo === "GET" && caminho === "/disponibilidade")
      return [200, disponibilidade({ data: q.get("data"), servico: q.get("servico"), servicos: q.get("servicos"), barbeiro: q.get("barbeiro") })];
    if (metodo === "POST" && caminho === "/agendamentos") return [201, criarAgendamento(corpo || {})];
    if (metodo === "GET" && caminho === "/sessao") return [200, { usuario: usuarioDaSessao() }];
    if (metodo === "POST" && caminho === "/admin/login") {
      const email = String(corpo?.email || "").trim().toLowerCase();
      const u = USUARIOS.find((x) => x.email === email);
      if (!u || corpo?.senha !== SENHA_DEMO) return [401, { erro: "E-mail ou senha incorretos." }];
      carregar().sessao = u.id;
      salvar();
      return [200, u];
    }
    if (metodo === "POST" && caminho === "/admin/logout") {
      carregar().sessao = null;
      salvar();
      return [204, null];
    }
    if (caminho.startsWith("/admin/")) {
      const usuario = usuarioDaSessao();
      if (!usuario) return [401, { erro: "Entre para continuar." }];
      const barbeiroFiltro = usuario.papel === "barbeiro" ? usuario.barbeiro_id : q.get("barbeiro") || null;
      if (metodo === "GET" && caminho === "/admin/me") return [200, usuario];
      if (metodo === "GET" && caminho === "/admin/agendamentos") {
        const filtro = { data: q.get("data"), barbeiroId: barbeiroFiltro };
        return [200, { agendamentos: listar({ ...filtro, status: q.get("status") || null }), resumo: resumo(filtro) }];
      }
      const m = caminho.match(/^\/admin\/agendamentos\/(\d+)$/);
      if (metodo === "PATCH" && m) return [200, mudarStatus(m[1], corpo?.status, usuario)];
      if (metodo === "DELETE" && m) return [200, excluir(m[1], usuario)];
      if (metodo === "DELETE" && caminho === "/admin/agendamentos")
        return [200, excluirCancelados(q.get("inicio"), q.get("fim"), barbeiroFiltro)];
    }
    return [404, { erro: "Rota não encontrada." }];
  }

  const fetchOriginal = self.fetch.bind(self);
  self.fetch = async function (entrada, opcoes = {}) {
    const url = new URL(typeof entrada === "string" ? entrada : entrada.url, location.href);
    const i = url.pathname.indexOf("/api/");
    if (url.origin !== location.origin || i === -1) return fetchOriginal(entrada, opcoes);

    const metodo = (opcoes.method || "GET").toUpperCase();
    let corpo = null;
    try {
      corpo = opcoes.body ? JSON.parse(opcoes.body) : null;
    } catch {
      return new Response(JSON.stringify({ erro: "JSON inválido." }), { status: 400 });
    }
    let status, dados;
    try {
      [status, dados] = rotear(metodo, url.pathname.slice(i + 4), url.searchParams, corpo);
    } catch (erro) {
      if (!(erro instanceof ErroNegocio)) console.error(erro);
      [status, dados] = erro instanceof ErroNegocio ? [erro.status, { erro: erro.message, campo: erro.campo }] : [500, { erro: "Erro interno. Tente novamente em instantes." }];
    }
    return new Response(status === 204 ? null : JSON.stringify(dados), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  // Aviso discreto de que é a versão de demonstração.
  document.addEventListener("DOMContentLoaded", () => {
    const faixa = document.createElement("div");
    faixa.setAttribute("role", "note");
    faixa.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:6px 12px;font:12px/1.4 system-ui,sans-serif;" +
      "text-align:center;background:rgba(10,10,10,.92);color:#d6d6d6;border-top:1px solid #333";
    faixa.textContent = "Versão de demonstração (GitHub Pages): os agendamentos ficam salvos só neste navegador. ";
    const fechar = document.createElement("button");
    fechar.type = "button";
    fechar.textContent = "Fechar";
    fechar.style.cssText = "margin-left:8px;background:none;border:1px solid #555;color:inherit;border-radius:4px;padding:1px 8px;cursor:pointer;font:inherit";
    fechar.addEventListener("click", () => faixa.remove());
    faixa.append(fechar);
    document.body.append(faixa);
  });
})();
