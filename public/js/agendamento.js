/* Agendamento online.
   1. Carrega serviços e barbeiros do banco (GET /api/servicos e /api/barbeiros).
   2. Mostra só os horários livres (GET /api/disponibilidade).
   3. Grava a reserva (POST /api/agendamentos) e abre o WhatsApp com o resumo.
   As regras de funcionamento vêm de regras.js; o servidor confere tudo de novo. */
const WHATSAPP_BARBEARIA = "5562993548184";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#formAgendamento");
  const confirmacao = document.querySelector("#confirmacao");
  const aviso = document.querySelector("#avisoSistema");
  if (!form || !confirmacao) return;

  const campoServico = form.elements.servico;
  const campoData = form.elements.data;
  const campoHora = form.elements.hora;
  const campoTelefone = form.elements.telefone;
  const dicaHora = document.querySelector("#dicaHora");
  const caixaBarbeiros = document.querySelector("#opcoesBarbeiro");
  const botaoEnviar = form.querySelector(".botaoEnviar");

  const hoje = hojeISO();
  campoData.min = hoje;
  campoData.max = somarDias(hoje, FUNCIONAMENTO.antecedenciaMaximaDias);

  const reais = (valor) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  function duracaoTexto(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return `${m}min`;
    return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  }

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
    const link = document.createElement("a");
    link.href = `https://wa.me/${WHATSAPP_BARBEARIA}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "agende pelo WhatsApp";
    aviso.append(`${texto} Se preferir, `, link, ".");
    aviso.hidden = false;
  }

  // ---------- Catálogo (serviços e barbeiros) ----------
  async function carregarCatalogo() {
    try {
      const [servicos, barbeiros] = await Promise.all([api("/api/servicos"), api("/api/barbeiros")]);

      campoServico.replaceChildren(new Option("Selecione o serviço", "", true, true));
      campoServico.options[0].disabled = true;
      const grupos = new Map();
      servicos.forEach((s) => {
        if (!grupos.has(s.categoria)) {
          const grupo = document.createElement("optgroup");
          grupo.label = s.categoria;
          grupos.set(s.categoria, grupo);
          campoServico.append(grupo);
        }
        const opcao = new Option(`${s.nome} · ${duracaoTexto(s.duracao_min)} · ${reais(s.preco_centavos / 100)}`, s.id);
        opcao.dataset.duracao = s.duracao_min;
        grupos.get(s.categoria).append(opcao);
      });

      const opcoes = [...barbeiros.map((b) => [b.id, b.nome, b.especialidade]), ["", "Sem preferência", "Primeiro disponível"]];
      caixaBarbeiros.replaceChildren(
        ...opcoes.map(([id, nome, especialidade], i) => {
          const rotulo = document.createElement("label");
          rotulo.className = "opcaoBarbeiro";
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = "barbeiro";
          radio.value = String(id);
          if (i === 0) radio.required = true;
          const n = document.createElement("span");
          n.className = "nomeBarbeiro";
          n.textContent = nome;
          const e = document.createElement("span");
          e.className = "especialidade";
          e.textContent = especialidade;
          rotulo.append(radio, n, e);
          return rotulo;
        })
      );

      campoServico.disabled = false;
      form.removeAttribute("aria-busy");
      prepararPreSelecao();
    } catch {
      mostrarAviso("O agendamento online está indisponível no momento.");
      botaoEnviar.disabled = true;
    }
  }

  // Link vindo do menu de serviços: agendamento.html?servico=ID
  function prepararPreSelecao() {
    const id = new URLSearchParams(location.search).get("servico");
    if (id && [...campoServico.options].some((o) => o.value === id)) campoServico.value = id;
  }

  // ---------- Horários livres ----------
  const barbeiroEscolhido = () => form.querySelector("input[name='barbeiro']:checked");
  let consulta = 0;

  function resetarHora(texto) {
    campoHora.replaceChildren(new Option(texto, "", true, true));
    campoHora.options[0].disabled = true;
    campoHora.disabled = true;
  }

  async function atualizarHorarios() {
    const servico = campoServico.value;
    const data = campoData.value;
    const anterior = campoHora.value;
    dicaHora.textContent = "";
    if (!servico || !data) return resetarHora("Escolha serviço e data");
    if (mensagemErro("data")) return resetarHora("Data indisponível");

    const minhaConsulta = ++consulta;
    resetarHora("Buscando horários…");
    const params = new URLSearchParams({ data, servico });
    const barbeiro = barbeiroEscolhido();
    if (barbeiro?.value) params.set("barbeiro", barbeiro.value);

    try {
      const { horarios } = await api(`/api/disponibilidade?${params}`);
      if (minhaConsulta !== consulta) return; // chegou uma resposta mais nova
      const livres = horarios.filter((h) => h.disponivel);
      if (!livres.length) {
        resetarHora("Sem horários livres");
        dicaHora.textContent = "Não há horários livres nesse dia. Tente outra data ou outro barbeiro.";
        return;
      }
      campoHora.replaceChildren(new Option("Selecione", "", true, true), ...livres.map((h) => new Option(h.hora, h.hora)));
      campoHora.options[0].disabled = true;
      campoHora.disabled = false;
      if (livres.some((h) => h.hora === anterior)) campoHora.value = anterior;
      dicaHora.textContent = `${livres.length} ${livres.length === 1 ? "horário livre" : "horários livres"}.`;
    } catch (erro) {
      if (minhaConsulta !== consulta) return;
      resetarHora("Data indisponível");
      dicaHora.textContent = erro.message;
    }
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
    const campo = form.elements[nome];
    switch (nome) {
      case "nome": {
        const valor = campo.value.trim();
        if (!valor) return "Informe seu nome.";
        if (valor.length < 3) return "O nome precisa ter pelo menos 3 letras.";
        return "";
      }
      case "telefone": {
        const d = campo.value.replace(/\D/g, "");
        if (!d) return "Informe seu WhatsApp para recebermos a confirmação.";
        if (!/^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(d)) return "Informe um número válido, com DDD.";
        return "";
      }
      case "servico":
        return campo.value ? "" : "Escolha um serviço.";
      case "data": {
        const valor = campo.value;
        if (!valor) return "Escolha uma data.";
        if (valor < hojeISO()) return "Escolha uma data a partir de hoje.";
        if (valor > campoData.max)
          return `Agendamos com até ${FUNCIONAMENTO.antecedenciaMaximaDias} dias de antecedência.`;
        return motivoDataFechada(valor);
      }
      case "hora":
        return campo.value ? "" : "Escolha um horário livre.";
      case "barbeiro":
        return barbeiroEscolhido() ? "" : "Escolha um barbeiro.";
      case "consentimento":
        return campo.checked ? "" : "Para agendar, aceite a Política de Privacidade.";
    }
    return "";
  }

  function caixaDoCampo(nome) {
    const campo = form.elements[nome];
    if (nome === "barbeiro") return caixaBarbeiros.closest(".campo");
    return campo.closest(".campo");
  }

  function marcarErro(nome, msg) {
    const caixa = caixaDoCampo(nome);
    caixa.classList.toggle("temErro", Boolean(msg));
    caixa.querySelector(".erroCampo").textContent = msg;
  }

  function validar(nome) {
    const msg = mensagemErro(nome);
    marcarErro(nome, msg);
    return !msg;
  }

  const nomesCampos = ["servico", "barbeiro", "data", "hora", "nome", "telefone", "consentimento"];

  nomesCampos.forEach((nome) => {
    const caixa = caixaDoCampo(nome);
    caixa.addEventListener("focusout", (e) => {
      if (nome === "barbeiro" && caixa.contains(e.relatedTarget)) return;
      const preenchido = nome === "consentimento" || nome === "barbeiro" ? false : form.elements[nome].value;
      if (form.dataset.tentou || preenchido) validar(nome);
    });
    ["input", "change"].forEach((evento) =>
      caixa.addEventListener(evento, () => {
        if (caixa.classList.contains("temErro")) validar(nome);
      })
    );
  });

  // Serviço, barbeiro ou data mudam os horários livres.
  campoServico.addEventListener("change", atualizarHorarios);
  campoData.addEventListener("change", () => {
    if (campoData.value) validar("data");
    atualizarHorarios();
  });
  caixaBarbeiros.addEventListener("change", atualizarHorarios);

  // ---------- Envio ----------
  function formatarData(iso) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    const semana = data.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
    return `${semana}, ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
  }

  function mostrarConfirmacao(nome, reserva) {
    const primeiroNome = nome.trim().split(/\s+/)[0];
    confirmacao.querySelector(".confirmacaoTexto").textContent =
      `${primeiroNome}, seu horário está reservado. Envie o resumo pelo WhatsApp: a equipe confirma por lá.`;

    const resumo = confirmacao.querySelector(".resumo");
    resumo.replaceChildren();
    [
      ["Código", reserva.codigo],
      ["Serviço", reserva.servico],
      ["Data", formatarData(reserva.data)],
      ["Horário", `${reserva.hora} às ${reserva.termino}`],
      ["Barbeiro", reserva.barbeiro],
      ["Valor", reais(reserva.preco)],
    ].forEach(([rotulo, valor]) => {
      const linha = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = rotulo;
      dd.textContent = valor;
      linha.append(dt, dd);
      resumo.append(linha);
    });

    confirmacao.querySelector("#abrirWhatsapp").href = reserva.whatsapp;
    form.hidden = true;
    confirmacao.hidden = false;
    confirmacao.focus();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.dataset.tentou = "1";
    mostrarAviso("");

    const invalidos = nomesCampos.filter((nome) => !validar(nome));
    if (invalidos.length) {
      const primeiro = invalidos[0] === "barbeiro" ? form.querySelector("input[name='barbeiro']") : form.elements[invalidos[0]];
      primeiro?.focus();
      return;
    }

    const pedido = {
      nome: form.elements.nome.value.trim().replace(/\s+/g, " "),
      telefone: campoTelefone.value,
      servicoId: Number(campoServico.value),
      barbeiroId: barbeiroEscolhido().value ? Number(barbeiroEscolhido().value) : null,
      data: campoData.value,
      hora: campoHora.value,
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
        (erro.campo === "barbeiro" ? form.querySelector("input[name='barbeiro']") : form.elements[erro.campo])?.focus();
      } else {
        mostrarAviso(erro.message);
      }
    } finally {
      botaoEnviar.disabled = false;
      botaoEnviar.textContent = "Confirmar agendamento";
    }
  });

  document.querySelector("#novoAgendamento").addEventListener("click", () => {
    form.reset();
    delete form.dataset.tentou;
    form.querySelectorAll(".temErro").forEach((c) => c.classList.remove("temErro"));
    form.querySelectorAll(".erroCampo").forEach((s) => (s.textContent = ""));
    resetarHora("Escolha serviço e data");
    dicaHora.textContent = "";
    confirmacao.hidden = true;
    form.hidden = false;
    campoServico.focus();
  });

  carregarCatalogo();
});
