/* Painel do barbeiro: agenda do dia, indicadores e mudança de situação dos atendimentos.
   Barbeiro vê só a própria agenda; administrador vê todas e pode filtrar por barbeiro. */
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

const ATUALIZAR_A_CADA_MS = 60 * 1000;

document.addEventListener("DOMContentLoaded", async () => {
  const el = (id) => document.getElementById(id);
  const painel = el("painel");
  const lista = el("listaAgenda");
  const modelo = el("modeloAtendimento");
  const campoData = el("dataPainel");
  const filtroBarbeiro = el("filtroBarbeiro");
  const filtroStatus = el("filtroStatus");
  const aviso = el("avisoPainel");
  const anuncio = el("mensagemStatus");

  const reais = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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

  function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.hidden = !texto;
  }

  // ---------- Sessão ----------
  let usuario;
  try {
    usuario = await api("/api/admin/me");
  } catch {
    return;
  }
  const papel = usuario.papel === "admin" ? "Administrador" : "Barbeiro";
  el("nomeUsuario").textContent = usuario.nome === papel ? papel : `${usuario.nome} · ${papel}`;
  el("sair").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    location.replace("index.html");
  });

  if (usuario.papel === "admin") {
    const barbeiros = await api("/api/barbeiros");
    barbeiros.forEach((b) => filtroBarbeiro.append(new Option(b.nome, b.id)));
  } else {
    el("caixaFiltroBarbeiro").hidden = true;
  }

  // ---------- Data ----------
  const parametros = new URLSearchParams(location.search);
  campoData.value = dataValida(parametros.get("data") || "") ? parametros.get("data") : hojeISO();

  function tituloDaData(iso) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    const texto = new Date(Date.UTC(ano, mes - 1, dia)).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    if (iso === hojeISO()) return `Hoje, ${texto.split(", ")[1]}`;
    return texto;
  }

  function irPara(iso) {
    campoData.value = iso;
    const url = new URL(location.href);
    url.searchParams.set("data", iso);
    history.replaceState(null, "", url);
    carregar();
  }

  el("diaAnterior").addEventListener("click", () => irPara(somarDias(campoData.value, -1)));
  el("proximoDia").addEventListener("click", () => irPara(somarDias(campoData.value, 1)));
  el("hoje").addEventListener("click", () => irPara(hojeISO()));
  campoData.addEventListener("change", () => dataValida(campoData.value) && irPara(campoData.value));
  filtroBarbeiro.addEventListener("change", () => carregar());
  filtroStatus.addEventListener("change", () => carregar());

  // ---------- Lista ----------
  function desenharAtendimento(a) {
    const item = modelo.content.firstElementChild.cloneNode(true);
    item.dataset.status = a.status;
    item.querySelector(".inicio").textContent = a.hora;
    item.querySelector(".fim").textContent = `até ${a.termino}`;
    item.querySelector(".cliente").textContent = a.cliente.nome;
    const etiqueta = item.querySelector(".etiquetaStatus");
    etiqueta.textContent = ROTULOS_STATUS[a.status];
    etiqueta.dataset.status = a.status;
    item.querySelector(".detalhes").textContent = `${a.servico.nome} · ${a.barbeiro.nome} · ${reais(a.preco)}`;

    const telefone = item.querySelector(".telefone");
    if (a.cliente.whatsapp) {
      const texto =
        a.status === "pendente"
          ? `Olá, ${a.cliente.nome.split(" ")[0]}! Aqui é da Nova Era Barbearia. Seu horário de ${a.hora} (${a.servico.nome}) com ${a.barbeiro.nome} está confirmado. Até lá!`
          : `Olá, ${a.cliente.nome.split(" ")[0]}! Aqui é da Nova Era Barbearia.`;
      telefone.href = `https://wa.me/${a.cliente.whatsapp}?text=${encodeURIComponent(texto)}`;
      telefone.textContent = `WhatsApp ${a.cliente.telefone}`;
    } else {
      telefone.remove();
    }
    item.querySelector(".codigo").textContent = `#${a.codigo}`;

    const acoes = item.querySelector(".acoesAtendimento");
    a.proximosStatus.forEach((para) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = `botao ${para === "confirmado" || para === "concluido" ? "" : "botaoContorno"} acao`;
      botao.dataset.para = para;
      botao.dataset.id = a.id;
      botao.textContent = ROTULOS_ACAO[para];
      botao.setAttribute("aria-label", `${ROTULOS_ACAO[para]}: ${a.cliente.nome}, ${a.hora}`);
      acoes.append(botao);
    });
    return item;
  }

  function desenharResumo(r) {
    el("indTotal").textContent = r.total;
    el("indPendentes").textContent = r.pendentes;
    el("indConfirmados").textContent = r.confirmados;
    el("indPrevisto").textContent = reais(r.faturamentoPrevisto);
    el("indRealizado").textContent = reais(r.faturamentoRealizado);
  }

  let carregando = 0;
  async function carregar() {
    const minha = ++carregando;
    el("tituloData").textContent = tituloDaData(campoData.value);
    const params = new URLSearchParams({ data: campoData.value });
    if (filtroBarbeiro.value) params.set("barbeiro", filtroBarbeiro.value);
    if (filtroStatus.value) params.set("status", filtroStatus.value);
    painel.setAttribute("aria-busy", "true");
    try {
      const { agendamentos, resumo } = await api(`/api/admin/agendamentos?${params}`);
      if (minha !== carregando) return;
      lista.replaceChildren(...agendamentos.map(desenharAtendimento));
      el("vazio").hidden = agendamentos.length > 0;
      desenharResumo(resumo);
      mostrarAviso("");
      el("atualizadoEm").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    } catch (erro) {
      if (minha === carregando) mostrarAviso(erro.message);
    } finally {
      if (minha === carregando) painel.removeAttribute("aria-busy");
    }
  }

  lista.addEventListener("click", async (e) => {
    const botao = e.target.closest(".acao");
    if (!botao) return;
    const para = botao.dataset.para;
    if (["cancelado", "faltou"].includes(para)) {
      const pergunta = para === "cancelado" ? "Cancelar este atendimento? O horário volta a ficar livre." : "Marcar que o cliente faltou?";
      if (!confirm(pergunta)) return;
    }
    botao.closest(".acoesAtendimento").querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const atualizado = await api(`/api/admin/agendamentos/${botao.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: para }),
      });
      anuncio.textContent = `${atualizado.cliente.nome}, ${atualizado.hora}: ${ROTULOS_STATUS[atualizado.status]}.`;
      await carregar();
    } catch (erro) {
      mostrarAviso(erro.message);
      await carregar();
    }
  });

  // Atualiza sozinho para mostrar agendamentos novos feitos pelo site.
  setInterval(() => {
    if (!document.hidden) carregar();
  }, ATUALIZAR_A_CADA_MS);
  document.addEventListener("visibilitychange", () => !document.hidden && carregar());

  carregar();
});
