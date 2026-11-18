document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#formAgendamento");
  const confirmacao = document.querySelector("#confirmacao");
  if (!form || !confirmacao) return;

  const campoData = form.elements.data;
  const campoHora = form.elements.hora;

  function hojeISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  campoData.min = hojeISO();

  function mensagemErro(nome) {
    const campo = form.elements[nome];
    const valor = nome === "barbeiro" ? campo.value : campo.value.trim();

    switch (nome) {
      case "nome":
        if (!valor) return "Informe seu nome.";
        if (valor.length < 3) return "O nome precisa ter pelo menos 3 letras.";
        return "";
      case "idade": {
        if (!valor) return "Informe sua idade.";
        const idade = Number(valor);
        if (!Number.isInteger(idade) || idade < 1 || idade > 120)
          return "Digite uma idade válida.";
        return "";
      }
      case "email":
        if (!valor) return "Informe seu e-mail.";
        if (campo.validity.typeMismatch || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor))
          return "Digite um e-mail válido.";
        return "";
      case "data": {
        if (!valor) return "Escolha uma data.";
        if (valor < campoData.min) return "Escolha uma data a partir de hoje.";
        const [ano, mes, dia] = valor.split("-").map(Number);
        if (new Date(ano, mes - 1, dia).getDay() === 0)
          return "Não abrimos aos domingos.";
        return "";
      }
      case "hora": {
        if (!valor) return "Escolha um horário.";
        if (campoData.value === hojeISO()) {
          const [h, m] = valor.split(":").map(Number);
          const agora = new Date();
          if (h * 60 + m <= agora.getHours() * 60 + agora.getMinutes())
            return "Esse horário já passou. Escolha outro.";
        }
        return "";
      }
      case "barbeiro":
        return valor ? "" : "Escolha um barbeiro.";
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

  const nomesCampos = ["nome", "idade", "email", "data", "hora", "barbeiro"];

  nomesCampos.forEach((nome) => {
    const caixa = caixaDoCampo(nome);
    caixa.addEventListener("focusout", (e) => {
      if (nome === "barbeiro" && caixa.contains(e.relatedTarget)) return;
      if (form.dataset.tentou || form.elements[nome].value) validar(nome);
    });
    caixa.addEventListener("input", () => {
      if (caixa.classList.contains("temErro")) validar(nome);
    });
    caixa.addEventListener("change", () => {
      if (caixa.classList.contains("temErro")) validar(nome);
    });
  });

  campoData.addEventListener("change", () => {
    if (campoHora.value) validar("hora");
  });

  function formatarData(iso) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
  }

  function mostrarConfirmacao(dados) {
    const primeiroNome = dados.nome.split(" ")[0];
    confirmacao.querySelector(".confirmacaoTexto").textContent =
      `Tudo certo, ${primeiroNome}! Enviaremos os detalhes para ${dados.email}.`;

    const resumo = confirmacao.querySelector(".resumo");
    resumo.replaceChildren();
    [
      ["Nome", dados.nome],
      ["Idade", `${dados.idade} anos`],
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
    dados.nome = dados.nome.trim();
    dados.email = dados.email.trim();
    mostrarConfirmacao(dados);
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
