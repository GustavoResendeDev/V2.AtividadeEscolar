/* Agendamento pelo WhatsApp.
   O formulário não envia nada para servidor nenhum: monta uma mensagem formatada
   e abre o WhatsApp da barbearia com ela pronta. Nenhum dado fica guardado no site.
   Usa FUNCIONAMENTO, agoraEmBrasilia() e eFeriado(), definidos em script.js. */
const WHATSAPP_BARBEARIA = "5562993548184";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#formAgendamento");
  const confirmacao = document.querySelector("#confirmacao");
  if (!form || !confirmacao) return;

  const campoData = form.elements.data;
  const campoHora = form.elements.hora;
  const campoServico = form.elements.servico;

  const doisDigitos = (n) => String(n).padStart(2, "0");

  // "Hoje" sempre no horário de Brasília, não no fuso de quem acessa.
  function hojeISO() {
    const { ano, mes, dia } = agoraEmBrasilia();
    return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
  }
  campoData.min = hojeISO();

  function paraMinutos(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function paraHora(minutos) {
    return `${doisDigitos(Math.floor(minutos / 60))}:${doisDigitos(minutos % 60)}`;
  }

  function duracaoServico() {
    const opcao = campoServico.selectedOptions[0];
    return Number(opcao?.dataset.duracao) || 0;
  }

  function mensagemErro(nome) {
    const campo = form.elements[nome];

    switch (nome) {
      case "nome": {
        const valor = campo.value.trim();
        if (!valor) return "Informe seu nome.";
        if (valor.length < 3) return "O nome precisa ter pelo menos 3 letras.";
        return "";
      }
      case "servico":
        return campo.value ? "" : "Escolha um serviço.";
      case "data": {
        const valor = campo.value;
        if (!valor) return "Escolha uma data.";
        if (valor < hojeISO()) return "Escolha uma data a partir de hoje.";
        const [ano, mes, dia] = valor.split("-").map(Number);
        const diaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
        if (!FUNCIONAMENTO.diasAbertos.includes(diaSemana)) return "Não abrimos aos domingos.";
        if (eFeriado(ano, mes, dia)) return "Estaremos fechados nesse dia (feriado).";
        return "";
      }
      case "hora": {
        const valor = campo.value;
        if (!valor) return "Escolha um horário.";
        const inicio = paraMinutos(valor);
        if (campoData.value === hojeISO() && inicio <= agoraEmBrasilia().minutos)
          return "Esse horário já passou. Escolha outro.";
        const duracao = duracaoServico();
        if (duracao && inicio + duracao > FUNCIONAMENTO.fecha) {
          const ultimo = Math.floor((FUNCIONAMENTO.fecha - duracao) / 30) * 30; // horários de 30 em 30 min
          return `Esse serviço termina depois das 19h. Escolha um horário até ${paraHora(ultimo)}.`;
        }
        return "";
      }
      case "barbeiro":
        return campo.value ? "" : "Escolha um barbeiro.";
      case "consentimento":
        return campo.checked ? "" : "Para agendar, aceite a Política de Privacidade.";
    }
    return "";
  }

  function caixaDoCampo(nome) {
    const campo = form.elements[nome];
    const el = campo instanceof RadioNodeList ? campo[0] : campo;
    return el.closest(".campo");
  }

  function validar(nome) {
    const msg = mensagemErro(nome);
    const caixa = caixaDoCampo(nome);
    caixa.classList.toggle("temErro", Boolean(msg));
    caixa.querySelector(".erroCampo").textContent = msg;
    return !msg;
  }

  const nomesCampos = ["nome", "servico", "data", "hora", "barbeiro", "consentimento"];

  nomesCampos.forEach((nome) => {
    const caixa = caixaDoCampo(nome);
    caixa.addEventListener("focusout", (e) => {
      if (nome === "barbeiro" && caixa.contains(e.relatedTarget)) return;
      const preenchido = nome === "consentimento" ? false : form.elements[nome].value;
      if (form.dataset.tentou || preenchido) validar(nome);
    });
    caixa.addEventListener("input", () => {
      if (caixa.classList.contains("temErro")) validar(nome);
    });
    caixa.addEventListener("change", () => {
      if (caixa.classList.contains("temErro")) validar(nome);
    });
  });

  // Data ou serviço mudam o que é um horário válido.
  [campoData, campoServico].forEach((campo) =>
    campo.addEventListener("change", () => {
      if (campoHora.value) validar("hora");
    })
  );

  function formatarData(iso) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    const semana = data.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
    return `${semana}, ${doisDigitos(dia)}/${doisDigitos(mes)}/${ano}`;
  }

  // Mensagem no formato do WhatsApp: *negrito* e _itálico_.
  function montarMensagem(dados) {
    const opcao = campoServico.selectedOptions[0];
    const duracao = Number(opcao.dataset.duracao);
    const termino = paraHora(paraMinutos(dados.hora) + duracao);

    return [
      "*NOVO AGENDAMENTO* ✂️",
      "_Nova Era Barbearia_",
      "",
      `👤 *Cliente:* ${dados.nome}`,
      `💈 *Serviço:* ${dados.servico}`,
      `💰 *Valor:* R$ ${opcao.dataset.preco}`,
      `📅 *Data:* ${formatarData(dados.data)}`,
      `⏰ *Horário:* ${dados.hora} às ${termino}`,
      `🧔 *Barbeiro:* ${dados.barbeiro}`,
      "",
      "Aguardo a confirmação. Obrigado!",
      "",
      "_Enviado pelo site. Dados tratados conforme a Política de Privacidade (LGPD)._",
    ].join("\n");
  }

  function linkWhatsapp(mensagem) {
    return `https://wa.me/${WHATSAPP_BARBEARIA}?text=${encodeURIComponent(mensagem)}`;
  }

  function mostrarConfirmacao(dados, link) {
    const primeiroNome = dados.nome.split(" ")[0];
    confirmacao.querySelector(".confirmacaoTexto").textContent =
      `${primeiroNome}, sua mensagem abriu no WhatsApp. Toque em enviar por lá; o horário fica reservado quando a barbearia confirmar.`;

    const resumo = confirmacao.querySelector(".resumo");
    resumo.replaceChildren();
    [
      ["Serviço", dados.servico],
      ["Data", formatarData(dados.data)],
      ["Horário", dados.hora],
      ["Barbeiro", dados.barbeiro],
    ].forEach(([rotulo, valor]) => {
      const linha = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = rotulo;
      dd.textContent = valor;
      linha.append(dt, dd);
      resumo.append(linha);
    });

    confirmacao.querySelector("#abrirWhatsapp").href = link;
    form.hidden = true;
    confirmacao.hidden = false;
    confirmacao.focus();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    form.dataset.tentou = "1";

    const invalidos = nomesCampos.filter((nome) => !validar(nome));
    if (invalidos.length) {
      const primeiro = form.elements[invalidos[0]];
      (primeiro instanceof RadioNodeList ? primeiro[0] : primeiro).focus();
      return;
    }

    const dados = Object.fromEntries(new FormData(form));
    dados.nome = dados.nome.trim().replace(/\s+/g, " ");
    const link = linkWhatsapp(montarMensagem(dados));

    // Abre em nova aba; se o navegador bloquear, abre na mesma.
    const janela = window.open(link, "_blank");
    if (janela) janela.opener = null;
    else window.location.href = link;
    mostrarConfirmacao(dados, link);
  });

  document.querySelector("#novoAgendamento").addEventListener("click", () => {
    form.reset();
    delete form.dataset.tentou;
    form.querySelectorAll(".temErro").forEach((c) => c.classList.remove("temErro"));
    form.querySelectorAll(".erroCampo").forEach((s) => (s.textContent = ""));
    confirmacao.hidden = true;
    form.hidden = false;
    form.elements.nome.focus();
  });
});
