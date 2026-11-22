/* Agendamento online, na ordem: nome, WhatsApp, data, horário, serviços (um ou mais) e barbeiro.
   1. Carrega serviços e barbeiros do banco (GET /api/servicos e /api/barbeiros).
   2. Mostra só os horários livres para o tempo total dos serviços (GET /api/disponibilidade).
   3. Grava a reserva (POST /api/agendamentos) e oferece o resumo pronto para o WhatsApp.
   As regras de funcionamento vêm de regras.js; o servidor confere tudo de novo. */
const WHATSAPP_BARBEARIA = "5562992002388";
const MAX_SERVICOS = 5;
const DIAS_ATALHO = 6; // quantos próximos dias abertos aparecem como atalho

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#formAgendamento");
  const confirmacao = document.querySelector("#confirmacao");
  const aviso = document.querySelector("#avisoSistema");
  if (!form || !confirmacao) return;

  const $ = (seletor) => document.querySelector(seletor);
  const campoNome = form.elements.nome;
  const campoTelefone = form.elements.telefone;
  const campoData = form.elements.data;
  const caixaHoras = $("#opcoesHora");
  const caixaServicos = $("#opcoesServico");
  const caixaBarbeiros = $("#opcoesBarbeiro");
  const dicaHora = $("#dicaHora");
  const dicaServicos = $("#dicaServicos");
  const botaoEnviar = form.querySelector(".botaoEnviar");

  const hoje = hojeISO();
  campoData.min = hoje;
  campoData.max = somarDias(hoje, FUNCIONAMENTO.antecedenciaMaximaDias);

  let servicos = [];
  let barbeiros = [];

  const reais = (valor) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  function duracaoTexto(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return `${m}min`;
    return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  }
  const criar = (tag, classe, texto) => {
    const no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined) no.textContent = texto;
    return no;
  };
  const partesData = (iso) => iso.split("-").map(Number);
  const diaDaSemana = (iso) => {
    const [a, m, d] = partesData(iso);
    return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  };

  async function api(caminho, opcoes = {}) {
    const resposta = await fetch(caminho, {
      ...opcoes,
      headers: { Accept: "application/json", ...(opcoes.body ? { "Content-Type": "application/json" } : {}) },
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const erro = new Error(corpo.erro || "Não foi possível falar com o sistema.");
      erro.campo = corpo.campo;
      erro.status = resposta.status;
      throw erro;
    }
    return corpo;
  }

  function mostrarAviso(texto) {
    aviso.textContent = "";
    if (!texto) {
      aviso.hidden = true;
      return;
    }
    const link = criar("a", "", "agende pelo WhatsApp");
    link.href = `https://wa.me/${WHATSAPP_BARBEARIA}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    aviso.append(`${texto} Se preferir, `, link, ".");
    aviso.hidden = false;
  }

  // ---------- Escolhas atuais ----------
  const servicosEscolhidos = () =>
    [...caixaServicos.querySelectorAll("input[name='servico']:checked")]
      .map((c) => servicos.find((s) => String(s.id) === c.value))
      .filter(Boolean);
  const duracaoTotal = () => servicosEscolhidos().reduce((t, s) => t + s.duracao_min, 0);
  const precoTotal = () => servicosEscolhidos().reduce((t, s) => t + s.preco_centavos, 0) / 100;
  const barbeiroEscolhido = () => form.querySelector("input[name='barbeiro']:checked");
  const horaEscolhida = () => form.querySelector("input[name='hora']:checked")?.value || "";

  // ---------- Catálogo (serviços e barbeiros) ----------
  async function carregarCatalogo() {
    try {
      [servicos, barbeiros] = await Promise.all([api("/api/servicos"), api("/api/barbeiros")]);
      desenharServicos();
      desenharBarbeiros();
      form.removeAttribute("aria-busy");
      prepararPreSelecao();
      atualizarResumo();
    } catch {
      caixaServicos.replaceChildren();
      mostrarAviso("O agendamento online está indisponível no momento.");
      botaoEnviar.disabled = true;
    }
  }

  function desenharServicos() {
    const grupos = new Map();
    servicos.forEach((s) => {
      if (!grupos.has(s.categoria)) grupos.set(s.categoria, []);
      grupos.get(s.categoria).push(s);
    });
    caixaServicos.replaceChildren(
      ...[...grupos].map(([categoria, lista]) => {
        const grupo = criar("div", "grupoServicos");
        grupo.append(criar("p", "categoriaServico", categoria));
        const grade = criar("div", "gradeServicos");
        lista.forEach((s) => {
          const opcao = criar("label", "opcaoServico");
          const caixa = criar("input");
          caixa.type = "checkbox";
          caixa.name = "servico";
          caixa.value = String(s.id);
          const marca = criar("span", "marcaServico");
          marca.setAttribute("aria-hidden", "true");
          const texto = criar("span", "textoServico");
          texto.append(criar("span", "nomeServico", s.nome), criar("span", "duracaoServico", duracaoTexto(s.duracao_min)));
          opcao.append(caixa, marca, texto, criar("span", "precoServico", reais(s.preco_centavos / 100)));
          grade.append(opcao);
        });
        grupo.append(grade);
        return grupo;
      })
    );
  }

  function desenharBarbeiros() {
    const opcoes = [
      ["", "Sem preferência", "Quem estiver disponível no horário"],
      ...barbeiros.map((b) => [b.id, b.nome, b.especialidade]),
    ];
    caixaBarbeiros.replaceChildren(
      ...opcoes.map(([id, nome, especialidade], i) => {
        const rotulo = criar("label", i === 0 ? "opcaoBarbeiro qualquerBarbeiro" : "opcaoBarbeiro");
        const radio = criar("input");
        radio.type = "radio";
        radio.name = "barbeiro";
        radio.value = String(id);
        if (i === 0) radio.checked = radio.defaultChecked = true; // em aberto: o sistema escolhe quem estiver livre
        const iniciais = criar("span", "avatarBarbeiro", i === 0 ? "✦" : nome.split(" ").map((p) => p[0]).slice(0, 2).join(""));
        iniciais.setAttribute("aria-hidden", "true");
        const textos = criar("span", "textosBarbeiro");
        textos.append(criar("span", "nomeBarbeiro", nome), criar("span", "especialidade", especialidade));
        rotulo.append(radio, iniciais, textos);
        return rotulo;
      })
    );
  }

  // Link vindo do menu de serviços: agendamento.html?servico=ID
  function prepararPreSelecao() {
    const id = new URLSearchParams(location.search).get("servico");
    const caixa = id && caixaServicos.querySelector(`input[value="${CSS.escape(id)}"]`);
    if (caixa) caixa.checked = true;
  }

  // ---------- Data: atalhos para os próximos dias abertos ----------
  function desenharAtalhosData() {
    const atalhos = [];
    for (let d = hoje, i = 0; atalhos.length < DIAS_ATALHO && i < 30; d = somarDias(d, 1), i++) {
      if (motivoDataFechada(d)) continue;
      // Hoje só aparece se ainda houver tempo de atender antes de fechar.
      if (d === hoje && agoraEmBrasilia().minutos >= FUNCIONAMENTO.fecha - FUNCIONAMENTO.intervaloGrade) continue;
      atalhos.push(d);
    }
    const nomesDias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    $("#atalhosData").replaceChildren(
      ...atalhos.map((d) => {
        const botao = criar("button", "atalhoData");
        botao.type = "button";
        botao.dataset.data = d;
        const rotulo = d === hoje ? "Hoje" : d === somarDias(hoje, 1) ? "Amanhã" : nomesDias[diaDaSemana(d)];
        const [, mes, dia] = partesData(d);
        botao.append(criar("span", "diaSemanaAtalho", rotulo), criar("strong", "diaAtalho", `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`));
        botao.setAttribute("aria-label", `${rotulo}, ${dia}/${mes}`);
        botao.addEventListener("click", () => {
          campoData.value = d;
          campoData.dispatchEvent(new Event("change", { bubbles: true }));
        });
        return botao;
      })
    );
  }

  function marcarAtalhoData() {
    document.querySelectorAll(".atalhoData").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.data === campoData.value)));
  }

  // ---------- Horários livres ----------
  let consulta = 0;

  function mostrarHorasVazias(texto) {
    caixaHoras.replaceChildren();
    caixaHoras.dataset.estado = "vazio";
    dicaHora.textContent = texto;
  }

  /* Busca os horários livres para o tempo total dos serviços escolhidos.
     Sem serviço escolhido ainda, mostra os horários para o serviço mais curto. */
  async function atualizarHorarios() {
    const data = campoData.value;
    const anterior = horaEscolhida();
    if (!data) return mostrarHorasVazias("Escolha a data para ver os horários livres.");
    if (mensagemErro("data")) return mostrarHorasVazias("Escolha outra data.");

    const escolhidos = servicosEscolhidos();
    const ids = escolhidos.length
      ? escolhidos.map((s) => s.id)
      : [servicos.reduce((menor, s) => (s.duracao_min < menor.duracao_min ? s : menor), servicos[0]).id];
    const minhaConsulta = ++consulta;
    caixaHoras.dataset.estado = "carregando";
    dicaHora.textContent = "Buscando horários livres…";
    const params = new URLSearchParams({ data, servicos: ids.join(",") });
    const barbeiro = barbeiroEscolhido();
    if (barbeiro?.value) params.set("barbeiro", barbeiro.value);

    try {
      const { horarios } = await api(`/api/disponibilidade?${params}`);
      if (minhaConsulta !== consulta) return; // chegou uma resposta mais nova
      const livres = horarios.filter((h) => h.disponivel);
      if (!livres.length) {
        mostrarHorasVazias(
          escolhidos.length
            ? "Não há horário livre nesse dia para esses serviços. Tente outra data ou outro barbeiro."
            : "Não há horários livres nesse dia. Tente outra data."
        );
        if (anterior) marcarErro("hora", "");
        atualizarResumo();
        return;
      }

      // Agrupa por período do dia para facilitar a leitura.
      const periodos = [
        ["Manhã", (m) => m < 12 * 60],
        ["Tarde", (m) => m >= 12 * 60 && m < 18 * 60],
        ["Noite", (m) => m >= 18 * 60],
      ];
      const blocos = periodos
        .map(([nome, filtro]) => [nome, livres.filter((h) => filtro(paraMinutos(h.hora)))])
        .filter(([, lista]) => lista.length)
        .map(([nome, lista]) => {
          const bloco = criar("div", "periodoHoras");
          bloco.append(criar("p", "nomePeriodo", nome));
          const grade = criar("div", "gradeHoras");
          lista.forEach((h) => {
            const opcao = criar("label", "opcaoHora");
            const radio = criar("input");
            radio.type = "radio";
            radio.name = "hora";
            radio.value = h.hora;
            if (h.hora === anterior) radio.checked = true;
            opcao.append(radio, criar("span", "", h.hora));
            grade.append(opcao);
          });
          bloco.append(grade);
          return bloco;
        });
      caixaHoras.replaceChildren(...blocos);
      caixaHoras.dataset.estado = "pronto";

      const tempo = escolhidos.length ? ` para ${duracaoTexto(duracaoTotal())} de serviço` : "";
      dicaHora.textContent = `${livres.length} ${livres.length === 1 ? "horário livre" : "horários livres"}${tempo}.`;

      // O horário escolhido antes deixou de caber (mais serviços, outro barbeiro ou outra data)?
      if (anterior && !livres.some((h) => h.hora === anterior)) {
        marcarErro(
          "hora",
          `O horário das ${anterior} não está livre ${escolhidos.length ? `para ${duracaoTexto(duracaoTotal())} de serviço` : "nesse dia"}. Escolha outro.`
        );
      } else if (anterior) {
        marcarErro("hora", "");
      }
    } catch (erro) {
      if (minhaConsulta !== consulta) return;
      mostrarHorasVazias(erro.message);
    }
    atualizarResumo();
  }

  // ---------- Resumo lateral ----------
  function formatarData(iso, curta = false) {
    const [ano, mes, dia] = partesData(iso);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    const semana = data.toLocaleDateString("pt-BR", { weekday: curta ? "short" : "long", timeZone: "UTC" }).replace(".", "");
    const texto = `${semana}, ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}${curta ? "" : `/${ano}`}`;
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function atualizarResumo() {
    const definir = (id, texto) => {
      const no = $(id);
      no.textContent = texto || "—";
      no.classList.toggle("vazioResumo", !texto);
    };
    definir("#resNome", campoNome.value.trim());

    const hora = horaEscolhida();
    let quando = "";
    if (campoData.value && !mensagemErro("data")) {
      quando = formatarData(campoData.value, true);
      if (hora) {
        const fim = paraHora(paraMinutos(hora) + (duracaoTotal() || 30));
        quando += ` · ${hora}${duracaoTotal() ? ` às ${fim}` : ""}`;
      }
    }
    definir("#resQuando", quando);

    const barbeiro = barbeiroEscolhido();
    $("#resBarbeiro").textContent = barbeiro?.value
      ? barbeiros.find((b) => String(b.id) === barbeiro.value)?.nome
      : "Quem estiver disponível";

    const escolhidos = servicosEscolhidos();
    const lista = $("#resServicos");
    if (escolhidos.length) {
      lista.replaceChildren(
        ...escolhidos.map((s) => {
          const li = criar("li");
          li.append(criar("span", "", s.nome), criar("span", "precoResumo", reais(s.preco_centavos / 100)));
          return li;
        })
      );
    } else {
      lista.replaceChildren(criar("li", "vazioResumo", "Nenhum serviço escolhido"));
    }
    $("#resDuracao").textContent = escolhidos.length ? `· ${duracaoTexto(duracaoTotal())}` : "";
    $("#resTotal").textContent = reais(precoTotal());

    dicaServicos.textContent = escolhidos.length
      ? `${escolhidos.length} ${escolhidos.length === 1 ? "serviço" : "serviços"} · ${duracaoTexto(duracaoTotal())} · ${reais(precoTotal())}`
      : "";

    // Limite de serviços: desativa as outras opções ao atingir o máximo.
    const noLimite = escolhidos.length >= MAX_SERVICOS;
    caixaServicos.querySelectorAll("input[name='servico']").forEach((c) => {
      c.disabled = noLimite && !c.checked;
      c.closest(".opcaoServico").classList.toggle("desativado", c.disabled);
    });
  }

  // ---------- Validação ----------
  function mascaraTelefone(valor) {
    const d = valor.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : "";
    const corte = d.length === 11 ? 7 : 6;
    if (d.length <= corte) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, corte)}-${d.slice(corte)}`;
  }
  campoTelefone.addEventListener("input", () => {
    campoTelefone.value = mascaraTelefone(campoTelefone.value);
  });

  function mensagemErro(nome) {
    switch (nome) {
      case "nome": {
        const valor = campoNome.value.trim();
        if (!valor) return "Informe seu nome completo.";
        if (valor.length < 3) return "O nome precisa ter pelo menos 3 letras.";
        return "";
      }
      case "telefone": {
        const d = campoTelefone.value.replace(/\D/g, "");
        if (!d) return "Informe seu WhatsApp para recebermos a confirmação.";
        if (!/^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(d)) return "Informe um número válido, com DDD.";
        return "";
      }
      case "data": {
        const valor = campoData.value;
        if (!valor) return "Escolha uma data.";
        if (valor < hojeISO()) return "Escolha uma data a partir de hoje.";
        if (valor > campoData.max) return `Agendamos com até ${FUNCIONAMENTO.antecedenciaMaximaDias} dias de antecedência.`;
        return motivoDataFechada(valor);
      }
      case "hora":
        return horaEscolhida() ? "" : "Escolha um dos horários livres.";
      case "servico":
        return servicosEscolhidos().length ? "" : "Escolha pelo menos um serviço.";
      case "barbeiro":
        return barbeiroEscolhido() ? "" : "Escolha um barbeiro ou deixe sem preferência.";
      case "consentimento":
        return form.elements.consentimento.checked ? "" : "Para agendar, aceite a Política de Privacidade.";
    }
    return "";
  }

  const caixas = {
    nome: () => campoNome.closest(".campo"),
    telefone: () => campoTelefone.closest(".campo"),
    data: () => campoData.closest(".campo"),
    hora: () => $("#campoHora"),
    servico: () => $("#campoServicos"),
    barbeiro: () => caixaBarbeiros.closest(".campo"),
    consentimento: () => form.elements.consentimento.closest(".campo"),
  };

  function marcarErro(nome, msg) {
    const caixa = caixas[nome]();
    caixa.classList.toggle("temErro", Boolean(msg));
    caixa.querySelector(".erroCampo").textContent = msg;
  }

  function validar(nome) {
    const msg = mensagemErro(nome);
    marcarErro(nome, msg);
    return !msg;
  }

  // Ordem do formulário: é também a ordem em que os erros recebem o foco.
  const nomesCampos = ["nome", "telefone", "data", "hora", "servico", "barbeiro", "consentimento"];

  ["nome", "telefone"].forEach((nome) => {
    const campo = form.elements[nome];
    campo.addEventListener("blur", () => (form.dataset.tentou || campo.value) && validar(nome));
    campo.addEventListener("input", () => {
      if (caixas[nome]().classList.contains("temErro")) validar(nome);
      atualizarResumo();
    });
  });

  campoData.addEventListener("change", () => {
    marcarAtalhoData();
    if (campoData.value) validar("data");
    atualizarHorarios();
  });

  caixaHoras.addEventListener("change", () => {
    marcarErro("hora", "");
    atualizarResumo();
  });

  // Serviços e barbeiro mudam o tempo necessário: os horários livres são recalculados.
  caixaServicos.addEventListener("change", () => {
    if (caixas.servico().classList.contains("temErro")) validar("servico");
    atualizarResumo();
    atualizarHorarios();
  });
  caixaBarbeiros.addEventListener("change", () => {
    atualizarResumo();
    atualizarHorarios();
  });
  form.elements.consentimento.addEventListener("change", () => {
    if (caixas.consentimento().classList.contains("temErro")) validar("consentimento");
  });

  // ---------- Envio ----------
  function focarCampo(nome) {
    const alvos = {
      hora: () => form.querySelector("input[name='hora']") || campoData,
      servico: () => form.querySelector("input[name='servico']"),
      barbeiro: () => form.querySelector("input[name='barbeiro']"),
    };
    const alvo = alvos[nome] ? alvos[nome]() : form.elements[nome];
    alvo?.focus();
    caixas[nome]().scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function mostrarConfirmacao(nome, reserva) {
    const primeiroNome = nome.trim().split(/\s+/)[0];
    confirmacao.querySelector(".confirmacaoTexto").textContent =
      `${primeiroNome}, seu horário está reservado. Envie o resumo pelo WhatsApp: a equipe confirma por lá.`;

    const resumo = confirmacao.querySelector(".resumo");
    resumo.replaceChildren();
    [
      ["Código", reserva.codigo],
      [reserva.servico.includes(",") ? "Serviços" : "Serviço", reserva.servico],
      ["Data", formatarData(reserva.data)],
      ["Horário", `${reserva.hora} às ${reserva.termino}`],
      ["Barbeiro", reserva.barbeiro],
      ["Valor", reais(reserva.preco)],
    ].forEach(([rotulo, valor]) => {
      const linha = criar("div");
      linha.append(criar("dt", "", rotulo), criar("dd", "", valor));
      resumo.append(linha);
    });

    confirmacao.querySelector("#abrirWhatsapp").href = reserva.whatsapp;
    form.hidden = true;
    $("#resumoLateral").hidden = true;
    confirmacao.hidden = false;
    confirmacao.focus();
    window.scrollTo({ top: 0 });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.dataset.tentou = "1";
    mostrarAviso("");

    const invalidos = nomesCampos.filter((nome) => !validar(nome));
    if (invalidos.length) return focarCampo(invalidos[0]);

    const pedido = {
      nome: campoNome.value.trim().replace(/\s+/g, " "),
      telefone: campoTelefone.value,
      data: campoData.value,
      hora: horaEscolhida(),
      servicoIds: servicosEscolhidos().map((s) => s.id),
      barbeiroId: barbeiroEscolhido().value ? Number(barbeiroEscolhido().value) : null,
      consentimento: form.elements.consentimento.checked,
    };

    botaoEnviar.disabled = true;
    botaoEnviar.textContent = "Reservando…";
    try {
      const reserva = await api("/api/agendamentos", { method: "POST", body: JSON.stringify(pedido) });
      // O WhatsApp abre pelo botão da confirmação: abrir sozinho depois de esperar
      // a resposta do servidor seria bloqueado como pop-up pelos navegadores.
      mostrarConfirmacao(pedido.nome, reserva);
    } catch (erro) {
      if (erro.campo && nomesCampos.includes(erro.campo)) {
        marcarErro(erro.campo, erro.message);
        if (erro.status === 409) atualizarHorarios();
        focarCampo(erro.campo);
      } else {
        mostrarAviso(erro.message);
      }
    } finally {
      botaoEnviar.disabled = false;
      botaoEnviar.textContent = "Confirmar agendamento";
    }
  });

  $("#novoAgendamento").addEventListener("click", () => {
    form.reset();
    delete form.dataset.tentou;
    form.querySelectorAll(".temErro").forEach((c) => c.classList.remove("temErro"));
    form.querySelectorAll(".erroCampo").forEach((s) => (s.textContent = ""));
    mostrarHorasVazias("Escolha a data para ver os horários livres.");
    marcarAtalhoData();
    confirmacao.hidden = true;
    form.hidden = false;
    $("#resumoLateral").hidden = false;
    atualizarResumo();
    campoNome.focus();
  });

  // Em telas estreitas o resumo entra no formulário, logo antes da confirmação;
  // em telas largas ele fica na coluna ao lado, acompanhando a rolagem.
  const resumoLateral = $("#resumoLateral");
  const grade = $(".gradeAgendamento");
  const telaEstreita = matchMedia("(max-width: 960px)");
  function posicionarResumo() {
    if (telaEstreita.matches) form.querySelector(".etapaFinal").before(resumoLateral);
    else grade.append(resumoLateral);
  }
  telaEstreita.addEventListener("change", posicionarResumo);
  posicionarResumo();

  desenharAtalhosData();
  mostrarHorasVazias("Escolha a data para ver os horários livres.");
  carregarCatalogo();
});
