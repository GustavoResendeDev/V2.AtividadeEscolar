/* Login do painel. Se já houver sessão válida, vai direto para a agenda. */
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("#formLogin");
  const erro = document.querySelector("#erroLogin");
  const senha = form.elements.senha;
  const botao = form.querySelector("button[type='submit']");
  const rotulo = botao.querySelector(".rotuloBotao");
  const mostrar = document.querySelector("#mostrarSenha");

  const sessao = await fetch("/api/sessao")
    .then((r) => r.json())
    .catch(() => ({}));
  if (sessao.usuario) return location.replace("painel.html");

  mostrar.addEventListener("click", () => {
    const visivel = senha.type === "text";
    senha.type = visivel ? "password" : "text";
    mostrar.setAttribute("aria-label", visivel ? "Mostrar senha" : "Ocultar senha");
    mostrar.setAttribute("aria-pressed", String(!visivel));
    senha.focus();
  });

  // Avisa quando o Caps Lock está ligado (causa comum de senha "errada").
  const avisoCaps = document.querySelector("#avisoCaps");
  const conferirCaps = (e) => {
    if (typeof e.getModifierState === "function") avisoCaps.hidden = !e.getModifierState("CapsLock");
  };
  senha.addEventListener("keydown", conferirCaps);
  senha.addEventListener("keyup", conferirCaps);
  senha.addEventListener("blur", () => (avisoCaps.hidden = true));

  function mostrarErro(texto) {
    erro.textContent = texto;
    erro.hidden = !texto;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.elements.email.value.trim();
    if (!email || !senha.value) {
      mostrarErro("Informe e-mail e senha.");
      (email ? senha : form.elements.email).focus();
      return;
    }

    botao.disabled = true;
    botao.classList.add("estaCarregando");
    rotulo.textContent = "Entrando…";
    mostrarErro("");
    try {
      const resposta = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha: senha.value }),
      });
      if (resposta.ok) return location.replace("painel.html");
      const corpo = await resposta.json().catch(() => ({}));
      mostrarErro(corpo.erro || "Não foi possível entrar.");
      senha.select();
    } catch {
      mostrarErro("Sem conexão com o sistema. Tente novamente.");
    } finally {
      botao.disabled = false;
      botao.classList.remove("estaCarregando");
      rotulo.textContent = "Entrar";
    }
  });
});
