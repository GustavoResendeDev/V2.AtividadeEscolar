/* Painel da equipe: calendário (dia, semana e mês) com arrastar e soltar, lista em tabelas,
   agendamento manual e relatório de atendimentos por barbeiro.
   Barbeiro vê e altera só a própria agenda; administrador vê todas e pode filtrar por barbeiro. */
const ROTULOS_STATUS = {
  pendente: "A confirmar",
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado",
  faltou: "Faltou",
};

const ROTULOS_ACAO = {
  confirmado: "Confirmar",
  concluido: "Concluir",
  faltou: "Faltou",
  cancelado: "Cancelar",
};

const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ATUALIZAR_A_CADA_MS = 60 * 1000;
const ABERTOS = ["pendente", "confirmado"]; // situações que ainda podem mudar de horário

document.addEventListener("DOMContentLoaded", async () => {
  const el = (id) => document.getElementById(id);
  const painel = el("painel");
  const campoData = el("dataPainel");
  const filtroBarbeiro = el("filtroBarbeiro");
  const filtroStatus = el("filtroStatus");
  const aviso = el("avisoPainel");
  const anuncio = el("mensagemStatus");
  const calendario = el("calendario");
  const rolagem = el("calendarioRolagem");

  const { abre, fecha, intervaloGrade } = FUNCIONAMENTO;
  const SLOTS = (fecha - abre) / intervaloGrade;

  const reais = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const criar = (tag, classe, texto) => {
    const no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined) no.textContent = texto;
    return no;
  };
  const partes = (iso) => iso.split("-").map(Number);
  const diaSemana = (iso) => new Date(Date.UTC(...partes(iso).map((n, i) => (i === 1 ? n - 1 : n)))).getUTCDay();
  const formatarData = (iso, opcoes) => {
    const [a, m, d] = partes(iso);
    return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("pt-BR", { timeZone: "UTC", ...opcoes });
  };
  const dataCurta = (iso) => `${DIAS_CURTOS[diaSemana(iso)]} ${formatarData(iso, { day: "2-digit", month: "2-digit" })}`;

  async function api(caminho, opcoes = {}) {
    const resposta = await fetch(caminho, {
      ...opcoes,
      headers: { Accept: "application/json", ...(opcoes.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (resposta.status === 401) {
      location.replace("index.html");
      throw new Error("Sessão expirada.");
    }
    const corpo = resposta.status === 204 ? {} : await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(corpo.erro || "Não foi possível falar com o sistema.");
    return corpo;
  }

  function mostrarErro(alvo, texto) {
    alvo.textContent = texto;
    alvo.hidden = !texto;
  }
  const mostrarAviso = (texto) => mostrarErro(aviso, texto);

  // ---------- Sessão ----------
  // Sessão e catálogo saem juntos (uma espera só em vez de duas seguidas).
  const catalogoPronto = Promise.all([api("/api/barbeiros"), api("/api/servicos")]);
  catalogoPronto.catch(() => {}); // o erro, se houver, aparece no await abaixo
  let usuario;
  try {
    usuario = await api("/api/admin/me");
  } catch {
    return;
  }
  const ehAdmin = usuario.papel === "admin";
  const papel = ehAdmin ? "Administrador" : "Barbeiro";
  el("nomeUsuario").textContent = usuario.nome === papel ? papel : `${usuario.nome} · ${papel}`;
  el("sair").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    location.replace("index.html");
  });

  const [todosBarbeiros, servicos] = await catalogoPronto;
  // Cada barbeiro ganha uma cor fixa no calendário (pela ordem do cadastro).
  const corDoBarbeiro = (id) => `var(--barbeiro-${(todosBarbeiros.findIndex((b) => b.id === id) % 6) + 1})`;
  const meusBarbeiros = ehAdmin ? todosBarbeiros : todosBarbeiros.filter((b) => b.id === usuario.barbeiro_id);

  if (ehAdmin) {
    todosBarbeiros.forEach((b) => filtroBarbeiro.append(new Option(b.nome, b.id)));
  } else {
    el("caixaFiltroBarbeiro").hidden = true;
    el("caixaNovoBarbeiro").hidden = true;
    el("caixaRemarcarBarbeiro").hidden = true;
  }

  // ---------- Estado: data, período (dia/semana/mês) e aba (calendário/lista) ----------
  const parametros = new URLSearchParams(location.search);
  const celular = matchMedia("(max-width: 700px)").matches;
  const estado = {
    data: dataValida(parametros.get("data") || "") ? parametros.get("data") : hojeISO(),
    modo: ["dia", "semana", "mes"].includes(parametros.get("modo")) ? parametros.get("modo") : celular ? "dia" : "semana",
    aba: parametros.get("aba") === "lista" ? "lista" : "calendario",
    agendamentos: [],
  };

  function segundaDaSemana(iso) {
    const d = diaSemana(iso);
    return somarDias(iso, d === 0 ? -6 : 1 - d);
  }

  function periodo() {
    if (estado.modo === "dia") return { inicio: estado.data, fim: estado.data };
    if (estado.modo === "semana") {
      const inicio = segundaDaSemana(estado.data);
      return { inicio, fim: somarDias(inicio, 6) };
    }
    const [a, m] = partes(estado.data);
    const inicio = `${a}-${String(m).padStart(2, "0")}-01`;
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    return { inicio, fim: `${a}-${String(m).padStart(2, "0")}-${ultimo}` };
  }

  function tituloDoPeriodo() {
    const { inicio, fim } = periodo();
    if (estado.modo === "dia") {
      const texto = formatarData(inicio, { weekday: "long", day: "numeric", month: "long" });
      return inicio === hojeISO() ? `Hoje, ${texto.split(", ")[1]}` : texto;
    }
    if (estado.modo === "semana") {
      const sabado = somarDias(inicio, 5);
      const mesmoMes = inicio.slice(0, 7) === sabado.slice(0, 7);
      const de = formatarData(inicio, mesmoMes ? { day: "numeric" } : { day: "numeric", month: "short" });
      return `${de} a ${formatarData(sabado, { day: "numeric", month: "short" })}`.replace(/\./g, "");
    }
    return formatarData(fim, { month: "long", year: "numeric" });
  }

  function salvarNaUrl() {
    const url = new URL(location.href);
    url.searchParams.set("data", estado.data);
    url.searchParams.set("modo", estado.modo);
    url.searchParams.set("aba", estado.aba);
    history.replaceState(null, "", url);
  }

  function irPara(iso) {
    estado.data = iso;
    carregar();
  }

  function andar(sentido) {
    if (estado.modo === "dia") {
      let d = somarDias(estado.data, sentido);
      if (diaSemana(d) === 0) d = somarDias(d, sentido); // pula o domingo
      return irPara(d);
    }
    if (estado.modo === "semana") return irPara(somarDias(estado.data, 7 * sentido));
    const [a, m] = partes(estado.data);
    const alvo = new Date(Date.UTC(a, m - 1 + sentido, 1));
    irPara(alvo.toISOString().slice(0, 10));
  }

  el("diaAnterior").addEventListener("click", () => andar(-1));
  el("proximoDia").addEventListener("click", () => andar(1));
  el("hoje").addEventListener("click", () => irPara(hojeISO()));
  campoData.addEventListener("change", () => dataValida(campoData.value) && irPara(campoData.value));
  filtroBarbeiro.addEventListener("change", () => carregar());
  filtroStatus.addEventListener("change", () => carregar());

  document.querySelectorAll("[data-modo]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.modo = b.dataset.modo;
      carregar();
    })
  );
  document.querySelectorAll("[data-aba]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.aba = b.dataset.aba;
      desenharTudo();
      salvarNaUrl();
    })
  );

  function marcarSeletores() {
    document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === estado.modo)));
    document.querySelectorAll("[data-aba]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === estado.aba)));
    el("vistaCalendario").hidden = estado.aba !== "calendario";
    el("vistaLista").hidden = estado.aba !== "lista";
    const nomes = { dia: "Agenda do dia", semana: "Agenda da semana", mes: "Agenda do mês" };
    el("rotuloPeriodo").textContent = nomes[estado.modo];
    el("tituloData").textContent = tituloDoPeriodo();
    campoData.value = estado.data;
  }

  // ---------- Carregar dados ----------
  let carregando = 0;
  async function carregar() {
    const minha = ++carregando;
    salvarNaUrl();
    marcarSeletores();
    const { inicio, fim } = periodo();
    const params = new URLSearchParams({ inicio, fim });
    if (filtroBarbeiro.value) params.set("barbeiro", filtroBarbeiro.value);
    if (filtroStatus.value) params.set("status", filtroStatus.value);
    painel.setAttribute("aria-busy", "true");
    try {
      const { agendamentos, resumo } = await api(`/api/admin/agendamentos?${params}`);
      if (minha !== carregando) return;
      estado.agendamentos = agendamentos;
      desenharResumo(resumo);
      desenharTudo();
      mostrarAviso("");
      el("atualizadoEm").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    } catch (erro) {
      if (minha === carregando) mostrarAviso(erro.message);
    } finally {
      if (minha === carregando) painel.removeAttribute("aria-busy");
    }
  }

  function desenharResumo(r) {
    const botaoLimpar = el("apagarCancelados");
    botaoLimpar.hidden = !r.cancelados;
    botaoLimpar.textContent = r.cancelados === 1 ? "Apagar 1 cancelado" : `Apagar ${r.cancelados} cancelados`;
    el("indTotal").textContent = r.total;
    el("indPendentes").textContent = r.pendentes;
    el("indConfirmados").textContent = r.confirmados;
    el("indConcluidos").textContent = r.concluidos;
    el("indPrevisto").textContent = reais(r.faturamentoPrevisto);
    el("indRealizado").textContent = reais(r.faturamentoRealizado);
  }

  function desenharTudo() {
    marcarSeletores();
    if (estado.aba === "calendario") desenharCalendario();
    else desenharLista();
  }

  // ---------- Calendário ----------
  const barbeirosVisiveis = () =>
    filtroBarbeiro.value ? meusBarbeiros.filter((b) => String(b.id) === filtroBarbeiro.value) : meusBarbeiros;

  // No calendário, cancelados saem da grade (liberam o horário), a não ser que o filtro peça por eles.
  const noCalendario = () =>
    estado.agendamentos.filter((a) => a.status !== "cancelado" || filtroStatus.value === "cancelado");

  const diaFechado = (iso) => motivoDataFechada(iso);
  const diaPassado = (iso) => iso < hojeISO();

  function desenharLegenda() {
    const legenda = el("legenda");
    legenda.replaceChildren();
    if (barbeirosVisiveis().length > 1 || estado.modo !== "dia") {
      barbeirosVisiveis().forEach((b) => {
        const item = criar("span", "itemLegenda", b.nome);
        item.style.setProperty("--cor", corDoBarbeiro(b.id));
        legenda.append(item);
      });
    }
    [["pendente", "A confirmar"], ["confirmado", "Confirmado"], ["concluido", "Concluído"], ["faltou", "Faltou"]].forEach(([s, t]) => {
      const item = criar("span", "itemLegenda itemStatus", t);
      item.dataset.status = s;
      legenda.append(item);
    });
  }

  function desenharCalendario() {
    desenharLegenda();
    calendario.dataset.modo = estado.modo;
    if (estado.modo === "mes") return desenharMes();

    // Colunas: no dia, uma por barbeiro; na semana, uma por dia (segunda a sábado).
    let colunas;
    if (estado.modo === "dia") {
      colunas = barbeirosVisiveis().map((b) => ({
        data: estado.data,
        barbeiro: b,
        titulo: b.nome,
        subtitulo: "",
      }));
    } else {
      const segunda = periodo().inicio;
      const barbeiro = barbeirosVisiveis().length === 1 ? barbeirosVisiveis()[0] : null;
      colunas = [0, 1, 2, 3, 4, 5].map((i) => {
        const data = somarDias(segunda, i);
        return { data, barbeiro, titulo: DIAS_CURTOS[diaSemana(data)], subtitulo: formatarData(data, { day: "2-digit", month: "2-digit" }) };
      });
    }

    calendario.style.setProperty("--colunas", colunas.length);
    calendario.style.setProperty("--slots", SLOTS);
    const fragmento = document.createDocumentFragment();

    // Cabeçalho
    fragmento.append(criar("div", "cantoCalendario"));
    colunas.forEach((c) => {
      const cab = criar("div", "cabecalhoColuna");
      if (estado.modo === "semana" && c.data === hojeISO()) cab.classList.add("ehHoje");
      const lista = noCalendario().filter((a) => a.data === c.data && (estado.modo === "semana" || a.barbeiro.id === c.barbeiro.id));
      if (estado.modo === "dia") {
        cab.style.setProperty("--cor", corDoBarbeiro(c.barbeiro.id));
        cab.classList.add("cabecalhoBarbeiro");
      }
      const titulo = criar("span", "tituloColuna", c.titulo);
      cab.append(titulo);
      if (c.subtitulo) {
        const botaoDia = criar("button", "subtituloColuna", c.subtitulo);
        botaoDia.type = "button";
        botaoDia.setAttribute("aria-label", `Ver o dia ${formatarData(c.data, { day: "numeric", month: "long" })}`);
        botaoDia.addEventListener("click", () => {
          estado.modo = "dia";
          irPara(c.data);
        });
        cab.append(botaoDia);
      }
      cab.append(criar("span", "contagemColuna", lista.length === 1 ? "1 atendimento" : `${lista.length} atendimentos`));
      fragmento.append(cab);
    });

    // Régua de horários
    const regua = criar("div", "reguaHoras");
    for (let i = 0; i < SLOTS; i += 2) regua.append(criar("span", "horaRegua", paraHora(abre + i * intervaloGrade)));
    fragmento.append(regua);

    // Colunas com os horários
    const agora = agoraEmBrasilia();
    colunas.forEach((c) => {
      const coluna = criar("div", "colunaDia");
      coluna.dataset.data = c.data;
      if (c.barbeiro) coluna.dataset.barbeiro = c.barbeiro.id;
      const fechado = diaFechado(c.data);
      const passado = diaPassado(c.data);
      if (fechado) {
        coluna.classList.add("fechado");
        coluna.append(criar("span", "avisoFechado", fechado.includes("feriado") ? "Fechado · feriado" : "Fechado"));
      } else if (passado) {
        coluna.classList.add("passado");
      } else {
        coluna.dataset.alvo = "grade";
        for (let i = 0; i < SLOTS; i++) {
          const hora = paraHora(abre + i * intervaloGrade);
          const slot = criar("button", "slot");
          slot.type = "button";
          slot.dataset.hora = hora;
          slot.style.setProperty("--linha", i + 1);
          slot.setAttribute(
            "aria-label",
            `Agendar ${dataCurta(c.data)} às ${hora}${c.barbeiro ? ` com ${c.barbeiro.nome}` : ""}`
          );
          slot.addEventListener("click", () => abrirNovo({ data: c.data, hora, barbeiroId: c.barbeiro?.id }));
          coluna.append(slot);
        }
      }

      // Linha do "agora"
      if (c.data === hojeISO() && agora.minutos >= abre && agora.minutos <= fecha) {
        const linha = criar("div", "linhaAgora");
        linha.style.setProperty("--minuto", agora.minutos - abre);
        coluna.append(linha);
      }

      const eventos = noCalendario().filter(
        (a) => a.data === c.data && (estado.modo === "semana" ? !c.barbeiro || a.barbeiro.id === c.barbeiro.id : a.barbeiro.id === c.barbeiro.id)
      );
      posicionarEventos(eventos).forEach(({ a, faixa, faixas }) => coluna.append(desenharEvento(a, faixa, faixas)));
      fragmento.append(coluna);
    });

    calendario.replaceChildren(fragmento);
    if (!rolagem.dataset.rolou) {
      // Na primeira vez, rola até perto do horário atual (ou da abertura).
      const minuto = Math.max(0, Math.min(agora.minutos, fecha) - abre - 60);
      rolagem.scrollTop = (minuto / intervaloGrade) * alturaSlot();
      rolagem.dataset.rolou = "1";
    }
  }

  const alturaSlot = () => parseFloat(getComputedStyle(calendario).getPropertyValue("--altura-slot")) || 48;

  // Atendimentos que se sobrepõem (vários barbeiros na mesma coluna da semana) dividem a largura.
  function posicionarEventos(lista) {
    const ordenados = [...lista].sort((a, b) => a.hora.localeCompare(b.hora));
    const grupos = [];
    let grupo = [];
    let fimGrupo = -1;
    ordenados.forEach((a) => {
      const ini = paraMinutos(a.hora);
      if (ini >= fimGrupo && grupo.length) {
        grupos.push(grupo);
        grupo = [];
      }
      grupo.push(a);
      fimGrupo = Math.max(fimGrupo, paraMinutos(a.termino));
    });
    if (grupo.length) grupos.push(grupo);

    const saida = [];
    grupos.forEach((g) => {
      const fimDasFaixas = [];
      const comFaixa = g.map((a) => {
        const ini = paraMinutos(a.hora);
        let faixa = fimDasFaixas.findIndex((f) => f <= ini);
        if (faixa === -1) faixa = fimDasFaixas.length;
        fimDasFaixas[faixa] = paraMinutos(a.termino);
        return { a, faixa };
      });
      comFaixa.forEach((x) => saida.push({ ...x, faixas: fimDasFaixas.length }));
    });
    return saida;
  }

  function desenharEvento(a, faixa = 0, faixas = 1) {
    const ev = criar("button", "evento");
    ev.type = "button";
    ev.dataset.id = a.id;
    ev.dataset.status = a.status;
    const inicio = paraMinutos(a.hora) - abre;
    const duracao = paraMinutos(a.termino) - paraMinutos(a.hora);
    ev.style.setProperty("--inicio", inicio);
    ev.style.setProperty("--duracao", duracao);
    ev.style.setProperty("--faixa", faixa);
    ev.style.setProperty("--faixas", faixas);
    ev.style.setProperty("--cor", corDoBarbeiro(a.barbeiro.id));
    if (duracao <= 30) ev.classList.add("curto");
    const podeMover = ABERTOS.includes(a.status) && !diaPassado(a.data);
    if (podeMover) ev.dataset.arrastavel = "1";

    const hora = criar("span", "horaEvento", `${a.hora}–${a.termino}`);
    const nome = criar("strong", "nomeEvento", a.cliente.nome);
    const detalhe = criar("span", "detalheEvento", estado.modo === "semana" ? `${a.servico.nome} · ${a.barbeiro.nome.split(" ")[0]}` : a.servico.nome);
    const status = criar("span", "statusEvento", ROTULOS_STATUS[a.status]);
    ev.append(hora, nome, detalhe, status);
    ev.setAttribute(
      "aria-label",
      `${a.hora} a ${a.termino}, ${a.cliente.nome}, ${a.servico.nome} com ${a.barbeiro.nome}, ${ROTULOS_STATUS[a.status]}${podeMover ? ". Arraste para remarcar" : ""}`
    );
    ev.addEventListener("click", (e) => {
      if (arraste.acabouDeSoltar) return e.preventDefault();
      abrirDetalhe(a.id);
    });
    return ev;
  }

  function desenharMes() {
    const { inicio, fim } = periodo();
    const primeira = segundaDaSemana(inicio);
    const semanas = Math.ceil((((diaSemana(inicio) + 6) % 7) + partes(fim)[2]) / 7);
    calendario.style.setProperty("--semanas", semanas);
    const fragmento = document.createDocumentFragment();
    ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].forEach((d) => fragmento.append(criar("div", "cabecalhoMes", d)));

    const porDia = {};
    noCalendario().forEach((a) => (porDia[a.data] ||= []).push(a));

    for (let i = 0; i < semanas * 7; i++) {
      const data = somarDias(primeira, i);
      const celula = criar("div", "diaMes");
      celula.dataset.data = data;
      const foraDoMes = data < inicio || data > fim;
      const fechado = diaFechado(data);
      if (foraDoMes) celula.classList.add("foraDoMes");
      if (fechado) celula.classList.add("fechado");
      if (diaPassado(data)) celula.classList.add("passado");
      if (data === hojeISO()) celula.classList.add("ehHoje");
      if (!fechado && !diaPassado(data)) celula.dataset.alvo = "dia";

      const topo = criar("div", "topoDiaMes");
      const numero = criar("button", "numeroDia", String(partes(data)[2]));
      numero.type = "button";
      numero.setAttribute("aria-label", `Abrir ${formatarData(data, { weekday: "long", day: "numeric", month: "long" })}`);
      numero.addEventListener("click", () => {
        estado.modo = "dia";
        irPara(data);
      });
      topo.append(numero);
      const lista = porDia[data] || [];
      if (lista.length) topo.append(criar("span", "totalDia", String(lista.length)));
      else if (fechado && !foraDoMes) topo.append(criar("span", "totalDia fechadoDia", "Fechado"));
      celula.append(topo);

      const MAX = 3;
      lista.slice(0, MAX).forEach((a) => {
        const chip = criar("button", "chipMes");
        chip.type = "button";
        chip.dataset.id = a.id;
        chip.dataset.status = a.status;
        chip.style.setProperty("--cor", corDoBarbeiro(a.barbeiro.id));
        if (ABERTOS.includes(a.status) && !diaPassado(a.data)) chip.dataset.arrastavel = "1";
        chip.append(criar("span", "horaChip", a.hora), criar("span", "nomeChip", a.cliente.nome));
        chip.setAttribute("aria-label", `${a.hora}, ${a.cliente.nome}, ${a.barbeiro.nome}, ${ROTULOS_STATUS[a.status]}`);
        chip.addEventListener("click", (e) => {
          if (arraste.acabouDeSoltar) return e.preventDefault();
          abrirDetalhe(a.id);
        });
        celula.append(chip);
      });
      if (lista.length > MAX) {
        const mais = criar("button", "maisMes", `+${lista.length - MAX} mais`);
        mais.type = "button";
        mais.addEventListener("click", () => {
          estado.modo = "dia";
          irPara(data);
        });
        celula.append(mais);
      }
      if (!foraDoMes && !fechado && !diaPassado(data)) {
        celula.addEventListener("dblclick", (e) => {
          if (e.target === celula || e.target.classList.contains("topoDiaMes")) abrirNovo({ data });
        });
      }
      fragmento.append(celula);
    }
    calendario.replaceChildren(fragmento);
  }

  // ---------- Arrastar e soltar (mouse, caneta e toque) ----------
  const arraste = { ativo: false, acabouDeSoltar: false };

  calendario.addEventListener("pointerdown", (e) => {
    const item = e.target.closest("[data-arrastavel]");
    if (!item || e.button > 0) return;
    const rect = item.getBoundingClientRect();
    Object.assign(arraste, {
      item,
      id: Number(item.dataset.id),
      x: e.clientX,
      y: e.clientY,
      deslocY: e.clientY - rect.top,
      deslocX: e.clientX - rect.left,
      ativo: false,
      ponteiro: e.pointerId,
      toque: e.pointerType !== "mouse",
      espera: null,
    });
    // No toque, segurar 350 ms inicia o arraste (assim o dedo ainda consegue rolar a agenda).
    if (arraste.toque) {
      arraste.espera = setTimeout(() => iniciarArraste(e), 350);
    }
  });

  function iniciarArraste(e) {
    arraste.ativo = true;
    const fantasma = arraste.item.cloneNode(true);
    fantasma.classList.add("fantasma");
    fantasma.removeAttribute("aria-label");
    const rect = arraste.item.getBoundingClientRect();
    fantasma.style.setProperty("--largura", `${rect.width}px`);
    fantasma.style.setProperty("--altura", `${rect.height}px`);
    document.body.append(fantasma);
    arraste.fantasma = fantasma;
    arraste.item.classList.add("arrastando");
    document.body.classList.add("modoArraste");
    navigator.vibrate?.(15);
    moverArraste(e.clientX, e.clientY);
  }

  function moverArraste(x, y) {
    arraste.fantasma.style.setProperty("--x", `${x - arraste.deslocX}px`);
    arraste.fantasma.style.setProperty("--y", `${y - arraste.deslocY}px`);
    arraste.ultimo = { x, y };
    arraste.destino = calcularDestino(x, y);
    desenharPrevia();
    // Rolagem automática perto das bordas da agenda.
    const r = rolagem.getBoundingClientRect();
    const margem = 48;
    arraste.rolarY = y < r.top + margem ? -10 : y > r.bottom - margem ? 10 : 0;
    arraste.rolarX = x < r.left + margem ? -10 : x > r.right - margem ? 10 : 0;
    if ((arraste.rolarY || arraste.rolarX) && !arraste.quadro) rolarSozinho();
  }

  function rolarSozinho() {
    arraste.quadro = requestAnimationFrame(() => {
      arraste.quadro = null;
      if (!arraste.ativo || (!arraste.rolarY && !arraste.rolarX)) return;
      rolagem.scrollBy(arraste.rolarX, arraste.rolarY);
      arraste.destino = calcularDestino(arraste.ultimo.x, arraste.ultimo.y);
      desenharPrevia();
      rolarSozinho();
    });
  }

  function calcularDestino(x, y) {
    const a = estado.agendamentos.find((ag) => ag.id === arraste.id);
    if (!a) return null;
    const sob = document.elementsFromPoint(x, y).find((n) => n.dataset?.alvo);
    if (!sob) return null;
    const duracao = paraMinutos(a.termino) - paraMinutos(a.hora);
    if (sob.dataset.alvo === "dia") {
      return { data: sob.dataset.data, hora: a.hora, barbeiroId: a.barbeiro.id, alvo: sob, duracao };
    }
    const rect = sob.getBoundingClientRect();
    const topo = y - arraste.deslocY - rect.top;
    let slot = Math.round(topo / alturaSlot());
    slot = Math.max(0, Math.min(slot, SLOTS - duracao / intervaloGrade));
    return {
      data: sob.dataset.data,
      hora: paraHora(abre + slot * intervaloGrade),
      barbeiroId: Number(sob.dataset.barbeiro) || a.barbeiro.id,
      alvo: sob,
      duracao,
    };
  }

  function desenharPrevia() {
    document.querySelectorAll(".previaSoltar, .alvoAtivo").forEach((n) => (n.classList.contains("previaSoltar") ? n.remove() : n.classList.remove("alvoAtivo")));
    const d = arraste.destino;
    if (!d) return;
    d.alvo.classList.add("alvoAtivo");
    if (d.alvo.dataset.alvo === "grade") {
      const previa = criar("div", "previaSoltar", `${d.hora}–${paraHora(paraMinutos(d.hora) + d.duracao)}`);
      previa.style.setProperty("--inicio", paraMinutos(d.hora) - abre);
      previa.style.setProperty("--duracao", d.duracao);
      const conflito = estado.agendamentos.some(
        (o) =>
          o.id !== arraste.id &&
          o.data === d.data &&
          o.barbeiro.id === d.barbeiroId &&
          o.status !== "cancelado" &&
          sobrepoe(paraMinutos(d.hora), paraMinutos(d.hora) + d.duracao, paraMinutos(o.hora), paraMinutos(o.termino))
      );
      if (conflito) previa.classList.add("comConflito");
      d.alvo.append(previa);
    }
  }

  document.addEventListener("pointermove", (e) => {
    if (!arraste.item || e.pointerId !== arraste.ponteiro) return;
    const distancia = Math.hypot(e.clientX - arraste.x, e.clientY - arraste.y);
    if (!arraste.ativo) {
      if (arraste.toque) {
        if (distancia > 8) cancelarArraste(); // o dedo quis rolar, não arrastar
        return;
      }
      if (distancia < 6) return;
      iniciarArraste(e);
    }
    e.preventDefault();
    moverArraste(e.clientX, e.clientY);
  });

  // Enquanto arrasta no toque, impede a página de rolar junto.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (arraste.ativo) e.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener("pointerup", async (e) => {
    if (!arraste.item || e.pointerId !== arraste.ponteiro) return;
    const foiArraste = arraste.ativo;
    const destino = arraste.destino;
    const id = arraste.id;
    cancelarArraste();
    if (!foiArraste) return;
    arraste.acabouDeSoltar = true;
    setTimeout(() => (arraste.acabouDeSoltar = false), 50);
    if (!destino) return;
    const a = estado.agendamentos.find((ag) => ag.id === id);
    if (a && a.data === destino.data && a.hora === destino.hora && a.barbeiro.id === destino.barbeiroId) return;
    await remarcar(id, destino);
  });

  document.addEventListener("pointercancel", cancelarArraste);
  // Segurar o dedo no atendimento não deve abrir o menu do navegador.
  calendario.addEventListener("contextmenu", (e) => e.target.closest("[data-arrastavel]") && e.preventDefault());
  document.addEventListener("keydown", (e) => e.key === "Escape" && arraste.ativo && cancelarArraste());

  function cancelarArraste() {
    clearTimeout(arraste.espera);
    if (arraste.quadro) cancelAnimationFrame(arraste.quadro);
    arraste.fantasma?.remove();
    arraste.item?.classList.remove("arrastando");
    document.body.classList.remove("modoArraste");
    document.querySelectorAll(".previaSoltar").forEach((n) => n.remove());
    document.querySelectorAll(".alvoAtivo").forEach((n) => n.classList.remove("alvoAtivo"));
    Object.assign(arraste, { item: null, ativo: false, fantasma: null, destino: null, quadro: null });
  }

  async function remarcar(id, destino) {
    painel.setAttribute("aria-busy", "true");
    try {
      const atualizado = await api(`/api/admin/agendamentos/${id}/horario`, {
        method: "PATCH",
        body: JSON.stringify({ data: destino.data, hora: destino.hora, barbeiroId: destino.barbeiroId }),
      });
      anuncio.textContent = `${atualizado.cliente.nome} remarcado para ${dataCurta(atualizado.data)} às ${atualizado.hora} com ${atualizado.barbeiro.nome}.`;
      avisoRapido(`Remarcado: ${atualizado.cliente.nome}, ${dataCurta(atualizado.data)} às ${atualizado.hora}`);
      await carregar();
      return atualizado;
    } catch (erro) {
      mostrarAviso(erro.message);
      painel.removeAttribute("aria-busy");
      throw erro;
    }
  }

  // Aviso rápido no canto da tela (some sozinho).
  let temporizadorAviso;
  function avisoRapido(texto) {
    let toast = document.querySelector(".avisoRapido");
    if (!toast) {
      toast = criar("div", "avisoRapido");
      toast.setAttribute("aria-hidden", "true");
      document.body.append(toast);
    }
    toast.textContent = texto;
    toast.classList.add("visivel");
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => toast.classList.remove("visivel"), 3200);
  }

  // ---------- Lista em tabelas ----------
  function celula(texto, rotulo, classe) {
    const td = criar("td", classe, texto);
    if (rotulo) td.dataset.rotulo = rotulo;
    return td;
  }

  // ---------- Mensagens ao cliente (WhatsApp) ----------
  const ENDERECO = "R. José Gomes Bailão, nº 579, Cidade Jardim, Goiânia - GO, 74423-500";
  const LINK_MAPA = "https://maps.app.goo.gl/fb81ei1H31uYVrbQA";

  /* Confirmação do agendamento: formato do WhatsApp (*negrito*, _itálico_), sem emojis. */
  function mensagemConfirmacao(a) {
    const primeiroNome = a.cliente.nome.split(" ")[0];
    const dia = formatarData(a.data, { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    return [
      "*AGENDAMENTO CONFIRMADO*",
      "_Nova Era Barbearia_",
      "",
      `Olá, ${primeiroNome}! Seu horário está confirmado. Estamos preparando tudo para receber você.`,
      "",
      `*Data:* ${dia.charAt(0).toUpperCase()}${dia.slice(1)}`,
      `*Horário:* ${a.hora} às ${a.termino}`,
      `*${a.servico.quantidade > 1 ? "Serviços" : "Serviço"}:* ${a.servico.nome}`,
      `*Barbeiro:* ${a.barbeiro.nome}`,
      `*Valor:* ${reais(a.preco)}`,
      `*Código:* ${a.codigo}`,
      "",
      "*ONDE ESTAMOS*",
      ENDERECO,
      `Como chegar: ${LINK_MAPA}`,
      "",
      "Recomendamos chegar com 5 minutos de antecedência. Se precisar remarcar ou cancelar, é só responder esta mensagem.",
      "",
      "Obrigado pela preferência e pela confiança. Será um prazer atender você!",
      "",
      "*Nova Era Barbearia*",
      "_Atendimento personalizado e de alta qualidade._",
    ].join("\n");
  }

  const linkParaCliente = (a, texto) => `https://wa.me/${a.cliente.whatsapp}?text=${encodeURIComponent(texto)}`;

  function linkWhatsapp(a) {
    if (!a.cliente.whatsapp) return null;
    const texto =
      a.status === "confirmado"
        ? mensagemConfirmacao(a)
        : `Olá, ${a.cliente.nome.split(" ")[0]}! Aqui é da Nova Era Barbearia.`;
    return linkParaCliente(a, texto);
  }

  /* Depois de confirmar, oferece o envio da confirmação ao cliente. O envio é um toque da equipe:
     o WhatsApp não permite mandar mensagens sozinho sem a API paga do WhatsApp Business. */
  const dialogoAvisarCliente = el("dialogoAvisarCliente");
  function oferecerAvisoAoCliente(a) {
    if (!a.cliente.whatsapp) return;
    const texto = mensagemConfirmacao(a);
    el("textoAvisarCliente").textContent = `Envie a confirmação com a localização para ${a.cliente.nome} (${a.cliente.telefone}).`;
    el("previaMensagem").textContent = texto.replace(/[*_]/g, "");
    el("enviarConfirmacao").href = linkParaCliente(a, texto);
    dialogoAvisarCliente.showModal();
  }
  el("enviarConfirmacao").addEventListener("click", () => setTimeout(() => dialogoAvisarCliente.close(), 0));

  function etiqueta(status) {
    const e = criar("span", "etiquetaStatus", ROTULOS_STATUS[status]);
    e.dataset.status = status;
    return e;
  }

  function botoesDeAcao(a) {
    return a.proximosStatus.map((para) => {
      const botao = criar("button", `botao ${para === "confirmado" || para === "concluido" ? "" : "botaoContorno"} acao`, ROTULOS_ACAO[para]);
      botao.type = "button";
      botao.dataset.para = para;
      botao.dataset.id = a.id;
      botao.setAttribute("aria-label", `${ROTULOS_ACAO[para]}: ${a.cliente.nome}, ${a.hora}`);
      return botao;
    });
  }

  function desenharLista() {
    const lista = estado.agendamentos;
    const corpo = el("listaAgenda");
    corpo.replaceChildren(
      ...lista.map((a) => {
        const tr = criar("tr", "atendimento");
        tr.dataset.status = a.status;
        tr.dataset.id = a.id;
        tr.append(celula(dataCurta(a.data), "Data", "colData"));
        tr.append(celula(`${a.hora}–${a.termino}`, "Horário", "colHora"));

        const tdCliente = celula("", "Cliente", "colCliente");
        const nome = criar("button", "nomeCliente", a.cliente.nome);
        nome.type = "button";
        nome.addEventListener("click", () => abrirDetalhe(a.id));
        tdCliente.append(nome);
        const link = linkWhatsapp(a);
        if (link) {
          const zap = criar("a", "telefoneCliente", a.cliente.telefone);
          zap.href = link;
          zap.target = "_blank";
          zap.rel = "noopener noreferrer";
          tdCliente.append(zap);
        }
        tr.append(tdCliente);

        tr.append(celula(a.servico.nome, "Serviço"));
        const tdBarbeiro = celula("", "Barbeiro");
        const marca = criar("span", "marcaBarbeiro", a.barbeiro.nome);
        marca.style.setProperty("--cor", corDoBarbeiro(a.barbeiro.id));
        tdBarbeiro.append(marca);
        tr.append(tdBarbeiro);
        tr.append(celula(reais(a.preco), "Valor", "numero"));
        const tdStatus = celula("", "Situação");
        tdStatus.append(etiqueta(a.status));
        tr.append(tdStatus);
        const tdAcoes = celula("", "", "colAcoes");
        const acoes = criar("div", "acoesAtendimento");
        acoes.append(...botoesDeAcao(a));
        tdAcoes.append(acoes);
        tr.append(tdAcoes);
        return tr;
      })
    );
    el("vazio").hidden = lista.length > 0;
    el("contagemLista").textContent = lista.length === 1 ? "1 atendimento" : `${lista.length} atendimentos`;
    desenharTabelaResumo();
  }

  /* Tabela de resumo: no dia, uma linha por barbeiro; na semana e no mês, uma linha por dia
     (e, no mês, também o total de cada semana). */
  function desenharTabelaResumo() {
    const colunas = ["Atend.", "A confirmar", "Confirm.", "Concluídos", "Faltas", "Cancel.", "Previsto", "Recebido"];
    const somar = (lista) => {
      const c = (s) => lista.filter((a) => a.status === s).length;
      const v = (estados) => lista.filter((a) => estados.includes(a.status)).reduce((t, a) => t + a.preco, 0);
      return [
        lista.filter((a) => a.status !== "cancelado").length,
        c("pendente"),
        c("confirmado"),
        c("concluido"),
        c("faltou"),
        c("cancelado"),
        v(["pendente", "confirmado", "concluido"]),
        v(["concluido"]),
      ];
    };
    const linha = (rotulo, valores, classe) => {
      const tr = criar("tr", classe);
      const th = criar("th", "", rotulo);
      th.scope = "row";
      tr.append(th);
      valores.forEach((v, i) => tr.append(celula(i >= 6 ? reais(v) : String(v), colunas[i], "numero")));
      return tr;
    };

    const primeira = estado.modo === "dia" ? "Barbeiro" : "Dia";
    const cab = criar("tr");
    [primeira, ...colunas].forEach((t, i) => {
      const th = criar("th", i ? "numero" : "", t);
      th.scope = "col";
      cab.append(th);
    });
    el("cabecaResumo").replaceChildren(cab);

    const lista = estado.agendamentos;
    const linhas = [];
    if (estado.modo === "dia") {
      el("tituloResumo").textContent = "Resumo do dia por barbeiro";
      barbeirosVisiveis().forEach((b) => linhas.push(linha(b.nome, somar(lista.filter((a) => a.barbeiro.id === b.id)))));
    } else {
      const { inicio, fim } = periodo();
      el("tituloResumo").textContent = estado.modo === "semana" ? "Resumo diário da semana" : "Resumo diário e semanal do mês";
      let semana = [];
      for (let d = inicio; d <= fim; d = somarDias(d, 1)) {
        const doDia = lista.filter((a) => a.data === d);
        const fechado = diaFechado(d);
        if (!(fechado && !doDia.length)) linhas.push(linha(dataCurta(d), somar(doDia), d === hojeISO() ? "ehHoje" : ""));
        semana.push(...doDia);
        const fimDaSemana = diaSemana(d) === 0 || d === fim;
        if (estado.modo === "mes" && fimDaSemana) {
          linhas.push(linha(`Semana até ${formatarData(d, { day: "2-digit", month: "2-digit" })}`, somar(semana), "linhaSemana"));
          semana = [];
        }
      }
    }
    el("corpoResumo").replaceChildren(...linhas);
    el("rodapeResumo").replaceChildren(linha("Total", somar(lista), "linhaTotal"));
  }

  // Botões de situação (lista e detalhes)
  async function mudarStatus(id, para, botoes) {
    const a = estado.agendamentos.find((ag) => ag.id === id);
    if (["cancelado", "faltou"].includes(para)) {
      const pergunta = para === "cancelado" ? "Cancelar este atendimento? O horário volta a ficar livre." : "Marcar que o cliente faltou?";
      if (!confirm(pergunta)) return null;
    }
    botoes.forEach((b) => (b.disabled = true));
    try {
      const atualizado = await api(`/api/admin/agendamentos/${id}`, { method: "PATCH", body: JSON.stringify({ status: para }) });
      anuncio.textContent = `${atualizado.cliente.nome}, ${atualizado.hora}: ${ROTULOS_STATUS[atualizado.status]}.`;
      avisoRapido(`${a ? a.cliente.nome : atualizado.cliente.nome}: ${ROTULOS_STATUS[atualizado.status]}`);
      await carregar();
      if (atualizado.status === "confirmado") oferecerAvisoAoCliente(atualizado);
      return atualizado;
    } catch (erro) {
      mostrarAviso(erro.message);
      await carregar();
      return null;
    }
  }

  el("listaAgenda").addEventListener("click", (e) => {
    const botao = e.target.closest(".acao");
    if (!botao) return;
    mudarStatus(Number(botao.dataset.id), botao.dataset.para, [...botao.parentElement.querySelectorAll("button")]);
  });

  // ---------- Diálogos ----------
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.closest("[data-fechar]")) d.close();
    });
  });

  function preencherHorarios(select, duracao, ocupados = [], valor) {
    select.replaceChildren();
    gradeDeHorarios(duracao).forEach((m) => {
      const hora = paraHora(m);
      const ocupado = ocupados.some((o) => sobrepoe(m, m + duracao, o.ini, o.fim));
      const op = new Option(ocupado ? `${hora} · ocupado` : hora, hora);
      op.disabled = ocupado;
      select.append(op);
    });
    if (valor && [...select.options].some((o) => o.value === valor && !o.disabled)) select.value = valor;
    else {
      const livre = [...select.options].find((o) => !o.disabled);
      if (livre) select.value = livre.value;
    }
  }

  // Horários já ocupados de um barbeiro num dia (busca no servidor para valer fora do período em tela).
  async function ocupadosDe(data, barbeiroId, ignorarId) {
    if (!dataValida(data) || !barbeiroId) return [];
    try {
      const { agendamentos } = await api(`/api/admin/agendamentos?${new URLSearchParams({ data, barbeiro: barbeiroId })}`);
      return agendamentos
        .filter((a) => a.id !== ignorarId && a.status !== "cancelado")
        .map((a) => ({ ini: paraMinutos(a.hora), fim: paraMinutos(a.termino) }));
    } catch {
      return [];
    }
  }

  // Novo agendamento
  const dialogoNovo = el("dialogoNovo");
  const formNovo = el("formNovo");
  const novoServicos = el("novoServicos");
  const novoBarbeiro = el("novoBarbeiro");
  const novoData = el("novoData");
  const novoHora = el("novoHora");

  const textoDuracao = (min) =>
    min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}` : `${min} min`;

  // Lista de marcar: a equipe pode registrar vários serviços no mesmo atendimento.
  servicos.forEach((s) => {
    const opcao = criar("label", "servicoMarcavel");
    const caixa = document.createElement("input");
    caixa.type = "checkbox";
    caixa.name = "servicoIds";
    caixa.value = s.id;
    opcao.append(caixa, criar("span", "", s.nome), criar("span", "detalheServico", `${textoDuracao(s.duracao_min)} · ${reais(s.preco_centavos / 100)}`));
    novoServicos.append(opcao);
  });

  const servicosMarcados = () =>
    [...novoServicos.querySelectorAll("input:checked")].map((c) => servicos.find((s) => String(s.id) === c.value)).filter(Boolean);

  function atualizarTotalNovo() {
    const marcados = servicosMarcados();
    const minutos = marcados.reduce((t, s) => t + s.duracao_min, 0);
    const centavos = marcados.reduce((t, s) => t + s.preco_centavos, 0);
    el("totalNovoServicos").textContent = marcados.length
      ? `${marcados.length} ${marcados.length > 1 ? "serviços" : "serviço"} · ${textoDuracao(minutos)} · ${reais(centavos / 100)}`
      : "Nenhum serviço marcado";
  }
  if (ehAdmin) novoBarbeiro.append(new Option("Quem estiver livre", ""));
  meusBarbeiros.forEach((b) => novoBarbeiro.append(new Option(b.nome, b.id)));

  const duracaoServico = () => servicosMarcados().reduce((t, s) => t + s.duracao_min, 0) || intervaloGrade;

  async function atualizarHorariosNovo(preferida) {
    const desejada = preferida || novoHora.value;
    const fechado = dataValida(novoData.value) ? diaFechado(novoData.value) : "";
    el("dicaNovo").textContent = fechado || (diaPassado(novoData.value) ? "Essa data já passou." : "");
    preencherHorarios(novoHora, duracaoServico(), [], desejada); // já mostra a grade; os ocupados chegam em seguida
    const ocupados = await ocupadosDe(novoData.value, novoBarbeiro.value || (ehAdmin ? "" : usuario.barbeiro_id));
    preencherHorarios(novoHora, duracaoServico(), ocupados, novoHora.value || desejada);
  }

  [novoServicos, novoBarbeiro, novoData].forEach((c) => c.addEventListener("change", () => atualizarHorariosNovo()));
  novoServicos.addEventListener("change", atualizarTotalNovo);

  function abrirNovo({ data, hora, barbeiroId } = {}) {
    formNovo.reset();
    atualizarTotalNovo();
    mostrarErro(el("erroNovo"), "");
    let dia = data || (estado.data >= hojeISO() ? estado.data : hojeISO());
    while (diaFechado(dia)) dia = somarDias(dia, 1);
    novoData.value = dia;
    novoData.min = hojeISO();
    // Hoje, sugere o próximo horário da grade (ainda dá para escolher um que já passou, para encaixes).
    if (!hora && dia === hojeISO()) {
      const agora = agoraEmBrasilia().minutos;
      const proximo = gradeDeHorarios(intervaloGrade).find((m) => m > agora);
      if (proximo) hora = paraHora(proximo);
    }
    if (barbeiroId) novoBarbeiro.value = barbeiroId;
    else if (filtroBarbeiro.value) novoBarbeiro.value = filtroBarbeiro.value;
    else novoBarbeiro.value = ehAdmin ? "" : usuario.barbeiro_id;
    atualizarHorariosNovo(hora);
    dialogoNovo.showModal();
    el("novoNome").focus();
  }
  el("novoAgendamento").addEventListener("click", () => abrirNovo());

  formNovo.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = el("novoNome").value.trim();
    if (nome.length < 2) {
      mostrarErro(el("erroNovo"), "Informe o nome do cliente.");
      return el("novoNome").focus();
    }
    const marcados = servicosMarcados();
    if (!marcados.length) {
      mostrarErro(el("erroNovo"), "Marque pelo menos um serviço.");
      return novoServicos.querySelector("input")?.focus();
    }
    const salvar = el("salvarNovo");
    salvar.disabled = true;
    try {
      const criado = await api("/api/admin/agendamentos", {
        method: "POST",
        body: JSON.stringify({
          nome,
          telefone: el("novoTelefone").value,
          servicoIds: marcados.map((s) => s.id),
          barbeiroId: Number(novoBarbeiro.value) || null,
          data: novoData.value,
          hora: novoHora.value,
          status: el("novoConcluido").checked ? "concluido" : "confirmado",
        }),
      });
      dialogoNovo.close();
      avisoRapido(`Agendado: ${criado.cliente.nome}, ${dataCurta(criado.data)} às ${criado.hora} com ${criado.barbeiro.nome}`);
      anuncio.textContent = `${criado.cliente.nome} agendado para ${dataCurta(criado.data)} às ${criado.hora}.`;
      const { inicio, fim } = periodo();
      if (criado.data < inicio || criado.data > fim) estado.data = criado.data;
      await carregar();
    } catch (erro) {
      mostrarErro(el("erroNovo"), erro.message);
      atualizarHorariosNovo();
    } finally {
      salvar.disabled = false;
    }
  });

  // Máscara simples do telefone
  el("novoTelefone").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) e.target.value = d ? `(${d}` : "";
    else if (d.length <= 6) e.target.value = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    else if (d.length <= 10) e.target.value = `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    else e.target.value = `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  });

  // Detalhes de um atendimento
  const dialogoDetalhe = el("dialogoDetalhe");
  const remarcarData = el("remarcarData");
  const remarcarHora = el("remarcarHora");
  const remarcarBarbeiro = el("remarcarBarbeiro");
  meusBarbeiros.forEach((b) => remarcarBarbeiro.append(new Option(b.nome, b.id)));
  let detalheAtual = null;

  async function atualizarHorariosRemarcar(preferida) {
    if (!detalheAtual) return;
    const duracao = paraMinutos(detalheAtual.termino) - paraMinutos(detalheAtual.hora);
    const desejada = preferida || remarcarHora.value;
    preencherHorarios(remarcarHora, duracao, [], desejada);
    const ocupados = await ocupadosDe(remarcarData.value, remarcarBarbeiro.value || detalheAtual.barbeiro.id, detalheAtual.id);
    preencherHorarios(remarcarHora, duracao, ocupados, remarcarHora.value || desejada);
  }
  [remarcarData, remarcarBarbeiro].forEach((c) => c.addEventListener("change", () => atualizarHorariosRemarcar()));

  function abrirDetalhe(id) {
    const a = estado.agendamentos.find((ag) => ag.id === id);
    if (!a) return;
    detalheAtual = a;
    mostrarErro(el("erroDetalhe"), "");
    el("detalheCodigo").textContent = `Atendimento #${a.codigo}`;
    el("tituloDetalhe").textContent = a.cliente.nome;

    const ficha = el("fichaDetalhe");
    ficha.replaceChildren();
    const item = (rotulo, valor) => {
      const div = criar("div");
      div.append(criar("dt", "", rotulo));
      const dd = criar("dd");
      if (valor instanceof Node) dd.append(valor);
      else dd.textContent = valor;
      div.append(dd);
      ficha.append(div);
    };
    item("Quando", `${formatarData(a.data, { weekday: "long", day: "numeric", month: "long" })}, ${a.hora} às ${a.termino}`);
    item("Serviço", `${a.servico.nome} · ${reais(a.preco)}`);
    const marca = criar("span", "marcaBarbeiro", a.barbeiro.nome);
    marca.style.setProperty("--cor", corDoBarbeiro(a.barbeiro.id));
    item("Barbeiro", marca);
    item("Situação", etiqueta(a.status));
    const link = linkWhatsapp(a);
    if (link) {
      const zap = criar("a", "linkWhatsapp", `WhatsApp ${a.cliente.telefone}`);
      zap.href = link;
      zap.target = "_blank";
      zap.rel = "noopener noreferrer";
      item("Contato", zap);
    } else {
      item("Contato", "Sem telefone cadastrado");
    }

    const acoes = el("acoesDetalhe");
    acoes.replaceChildren(...botoesDeAcao(a));
    acoes.hidden = !a.proximosStatus.length;

    const podeRemarcar = ABERTOS.includes(a.status) && !diaPassado(a.data);
    el("formRemarcar").hidden = !podeRemarcar;
    if (podeRemarcar) {
      remarcarData.min = hojeISO();
      remarcarData.value = a.data;
      remarcarBarbeiro.value = a.barbeiro.id;
      atualizarHorariosRemarcar(a.hora);
    }
    dialogoDetalhe.showModal();
  }

  // ---------- Apagar ----------
  el("apagarAtendimento").addEventListener("click", async () => {
    const a = detalheAtual;
    if (!a) return;
    const quando = `${dataCurta(a.data)} às ${a.hora}`;
    if (!confirm(`Apagar o atendimento de ${a.cliente.nome} (${quando})?\n\nEle some da agenda e dos relatórios. Não dá para desfazer.`)) return;
    const botao = el("apagarAtendimento");
    botao.disabled = true;
    try {
      await api(`/api/admin/agendamentos/${a.id}`, { method: "DELETE", body: "{}" });
      dialogoDetalhe.close();
      avisoRapido(`Apagado: ${a.cliente.nome}, ${quando}`);
      anuncio.textContent = `Atendimento de ${a.cliente.nome} apagado.`;
      await carregar();
    } catch (erro) {
      mostrarErro(el("erroDetalhe"), erro.message);
    } finally {
      botao.disabled = false;
    }
  });

  el("apagarCancelados").addEventListener("click", async (e) => {
    const botao = e.currentTarget;
    const { inicio, fim } = periodo();
    const quando = inicio === fim ? dataCurta(inicio) : `${dataCurta(inicio)} a ${dataCurta(fim)}`;
    if (!confirm(`Apagar todos os atendimentos cancelados de ${quando}?\n\nNão dá para desfazer.`)) return;
    const params = new URLSearchParams({ inicio, fim });
    if (filtroBarbeiro.value) params.set("barbeiro", filtroBarbeiro.value);
    botao.disabled = true;
    try {
      const { apagados } = await api(`/api/admin/agendamentos?${params}`, { method: "DELETE", body: "{}" });
      avisoRapido(apagados === 1 ? "1 cancelado apagado" : `${apagados} cancelados apagados`);
      await carregar();
    } catch (erro) {
      mostrarAviso(erro.message);
    } finally {
      botao.disabled = false;
    }
  });

  el("acoesDetalhe").addEventListener("click", async (e) => {
    const botao = e.target.closest(".acao");
    if (!botao) return;
    const atualizado = await mudarStatus(Number(botao.dataset.id), botao.dataset.para, [...el("acoesDetalhe").querySelectorAll("button")]);
    if (atualizado) dialogoDetalhe.close();
  });

  el("formRemarcar").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!detalheAtual) return;
    try {
      await remarcar(detalheAtual.id, {
        data: remarcarData.value,
        hora: remarcarHora.value,
        barbeiroId: Number(remarcarBarbeiro.value) || detalheAtual.barbeiro.id,
      });
      dialogoDetalhe.close();
    } catch (erro) {
      mostrarErro(el("erroDetalhe"), erro.message);
    }
  });

  // ---------- Relatório por barbeiro ----------
  const dialogoRelatorio = el("dialogoRelatorio");
  const relInicio = el("relInicio");
  const relFim = el("relFim");
  let ultimoRelatorio = null;

  /* Cada barbeiro emite o próprio relatório (o servidor só devolve os dados dele).
     O administrador escolhe: estabelecimento completo ou um barbeiro. */
  const relBarbeiro = el("relBarbeiro");
  if (ehAdmin) {
    relBarbeiro.append(new Option("Estabelecimento completo", ""));
    todosBarbeiros.forEach((b) => relBarbeiro.append(new Option(b.nome, b.id)));
    el("caixaRelBarbeiro").hidden = false;
    relBarbeiro.addEventListener("change", () => gerarRelatorio());
  } else {
    el("tituloRelatorio").textContent = "Meu relatório de rendimento";
  }
  const nomeDoRelatorio = () =>
    ehAdmin && !relBarbeiro.value ? "Estabelecimento completo" : (meusBarbeiros.find((b) => String(b.id) === (relBarbeiro.value || String(usuario.barbeiro_id))) || {}).nome || usuario.nome;

  function periodoDoAtalho(modo) {
    const salvo = { modo: estado.modo, data: estado.data };
    estado.modo = modo;
    estado.data = hojeISO();
    const p = periodo();
    Object.assign(estado, salvo);
    return p;
  }

  el("abrirRelatorio").addEventListener("click", () => {
    const p = periodo();
    relInicio.value = p.inicio;
    relFim.value = p.fim;
    dialogoRelatorio.showModal();
    gerarRelatorio();
  });

  document.querySelectorAll("[data-atalho]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = periodoDoAtalho(b.dataset.atalho);
      relInicio.value = p.inicio;
      relFim.value = p.fim;
      gerarRelatorio();
    })
  );

  el("formRelatorio").addEventListener("submit", (e) => {
    e.preventDefault();
    gerarRelatorio();
  });

  async function gerarRelatorio() {
    const erro = el("erroRelatorio");
    mostrarErro(erro, "");
    if (!dataValida(relInicio.value) || !dataValida(relFim.value)) return mostrarErro(erro, "Escolha as duas datas.");
    const botao = el("gerarRelatorio");
    botao.disabled = true;
    try {
      const filtro = { inicio: relInicio.value, fim: relFim.value };
      if (ehAdmin && relBarbeiro.value) filtro.barbeiro = relBarbeiro.value;
      const r = await api(`/api/admin/relatorio?${new URLSearchParams(filtro)}`);
      ultimoRelatorio = r;
      desenharRelatorio(r);
    } catch (e) {
      mostrarErro(erro, e.message);
      el("resultadoRelatorio").hidden = true;
    } finally {
      botao.disabled = false;
    }
  }

  function desenharRelatorio(r) {
    const longo = { day: "numeric", month: "long", year: "numeric" };
    const quando = r.inicio === r.fim ? formatarData(r.inicio, longo) : `${formatarData(r.inicio, longo)} a ${formatarData(r.fim, longo)}`;
    el("periodoRelatorio").textContent = `${nomeDoRelatorio()} · ${quando}`;

    const destaques = el("destaquesRelatorio");
    const lider = r.barbeiros[0];
    const cartao = (rotulo, valor, extra) => {
      const c = criar("div", "indicador");
      c.append(criar("span", "rotuloIndicador", rotulo), criar("strong", "", valor));
      if (extra) c.append(criar("span", "extraIndicador", extra));
      return c;
    };
    destaques.replaceChildren(
      cartao("Pessoas atendidas", String(r.totais.atendidos)),
      cartao("Faturado", reais(r.totais.faturado)),
      cartao("Faltas", String(r.totais.faltas)),
      cartao("Mais atendimentos", lider && lider.atendidos ? lider.nome.split(" ")[0] : "–", lider && lider.atendidos ? `${lider.atendidos} ${lider.atendidos === 1 ? "pessoa" : "pessoas"}` : "")
    );

    // Barras: quantas pessoas cada barbeiro atendeu
    const maior = Math.max(1, ...r.barbeiros.map((b) => b.atendidos));
    el("barrasRelatorio").replaceChildren(
      ...r.barbeiros.map((b) => {
        const linha = criar("div", "linhaBarra");
        linha.style.setProperty("--cor", corDoBarbeiro(b.id));
        linha.style.setProperty("--proporcao", b.atendidos / maior);
        const trilho = criar("div", "trilhoBarra");
        trilho.append(criar("div", "barra"));
        linha.append(criar("span", "nomeBarra", b.nome), trilho, criar("strong", "valorBarra", String(b.atendidos)));
        return linha;
      })
    );

    const pct = (v) => (v === null ? "–" : `${v}%`);
    const cab = ["Barbeiro", "Pessoas atendidas", "Clientes diferentes", "Aguardando", "Faltas", "Cancelados", "Comparecimento", "Horas", "Faturado", "Ticket médio"];
    const linhaTabela = (valores, classe) => {
      const tr = criar("tr", classe);
      valores.forEach((v, i) => {
        if (i === 0) {
          const th = criar("th", "", "");
          th.scope = "row";
          if (v instanceof Node) th.append(v);
          else th.textContent = v;
          tr.append(th);
        } else tr.append(celula(v, cab[i], "numero"));
      });
      return tr;
    };
    el("corpoRelatorio").replaceChildren(
      ...r.barbeiros.map((b) => {
        const marca = criar("span", "marcaBarbeiro", b.nome);
        marca.style.setProperty("--cor", corDoBarbeiro(b.id));
        return linhaTabela([
          marca,
          String(b.atendidos),
          String(b.clientesUnicos),
          String(b.aguardando),
          String(b.faltas),
          String(b.cancelados),
          pct(b.comparecimento),
          String(b.horasTrabalhadas).replace(".", ","),
          reais(b.faturado),
          reais(b.ticketMedio),
        ]);
      })
    );
    const t = r.totais;
    const comparecimento = t.atendidos + t.faltas ? Math.round((t.atendidos / (t.atendidos + t.faltas)) * 100) : null;
    el("rodapeRelatorio").replaceChildren(
      linhaTabela(
        [
          "Total",
          String(t.atendidos),
          "–",
          String(t.aguardando),
          String(t.faltas),
          String(t.cancelados),
          pct(comparecimento),
          String(t.horasTrabalhadas).replace(".", ","),
          reais(t.faturado),
          reais(t.atendidos ? t.faturado / t.atendidos : 0),
        ],
        "linhaTotal"
      )
    );
    el("resultadoRelatorio").hidden = false;
  }

  el("imprimirRelatorio").addEventListener("click", () => {
    document.body.classList.add("imprimindoRelatorio");
    window.print();
  });
  window.addEventListener("afterprint", () => document.body.classList.remove("imprimindoRelatorio"));

  el("baixarCsv").addEventListener("click", () => {
    if (!ultimoRelatorio) return;
    const r = ultimoRelatorio;
    const num = (v) => String(v).replace(".", ",");
    const linhas = [
      ["Barbeiro", "Pessoas atendidas", "Clientes diferentes", "Aguardando", "Faltas", "Cancelados", "Comparecimento (%)", "Horas", "Faturado (R$)", "Ticket médio (R$)"],
      ...r.barbeiros.map((b) => [
        b.nome,
        b.atendidos,
        b.clientesUnicos,
        b.aguardando,
        b.faltas,
        b.cancelados,
        b.comparecimento ?? "",
        num(b.horasTrabalhadas),
        num(b.faturado.toFixed(2)),
        num(b.ticketMedio.toFixed(2)),
      ]),
      ["Total", r.totais.atendidos, "", r.totais.aguardando, r.totais.faltas, r.totais.cancelados, "", num(r.totais.horasTrabalhadas), num(r.totais.faturado.toFixed(2)), ""],
    ];
    // Ponto e vírgula + BOM: abre direto no Excel em português com acentos certos.
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = criar("a");
    a.href = url;
    const quem = nomeDoRelatorio().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    a.download = `relatorio-${quem}-${r.inicio}-a-${r.fim}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // ---------- Atualização automática ----------
  // Atualiza sozinho para mostrar agendamentos novos feitos pelo site (menos durante um arraste ou com diálogo aberto).
  setInterval(() => {
    if (!document.hidden && !arraste.item && !document.querySelector("dialog[open]")) carregar();
  }, ATUALIZAR_A_CADA_MS);
  document.addEventListener("visibilitychange", () => !document.hidden && !document.querySelector("dialog[open]") && carregar());

  carregar();
});
