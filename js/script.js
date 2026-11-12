/* =========================================================
   HEADER, MENU ATIVO E ANIMAÇÕES DE ENTRADA
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector("header");
  const linksMenu = document.querySelectorAll(".menu a[href^='#']");

  // Header com fundo de vidro depois de rolar um pouco
  function atualizarHeader() {
    header.classList.toggle("scrolled", window.scrollY > 40);
  }
  atualizarHeader();
  window.addEventListener("scroll", atualizarHeader, { passive: true });

  if (!("IntersectionObserver" in window)) {
    document
      .querySelectorAll("[data-revelar]")
      .forEach((el) => el.classList.add("visivel"));
    return;
  }

  // Destaca no menu a seção que está na tela
  const secoes = [...linksMenu]
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  const observadorMenu = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((entrada) => {
        if (!entrada.isIntersecting) return;
        linksMenu.forEach((link) =>
          link.classList.toggle(
            "atual",
            link.getAttribute("href") === "#" + entrada.target.id,
          ),
        );
      });
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  secoes.forEach((secao) => observadorMenu.observe(secao));

  // Remove o destaque quando volta para o topo (hero)
  window.addEventListener(
    "scroll",
    () => {
      if (secoes[0] && secoes[0].getBoundingClientRect().top > innerHeight * 0.5) {
        linksMenu.forEach((link) => link.classList.remove("atual"));
      }
    },
    { passive: true },
  );

  // Elementos com [data-revelar] aparecem ao entrar na tela
  const observadorRevelar = new IntersectionObserver(
    (entradas, obs) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
          entrada.target.classList.add("visivel");
          obs.unobserve(entrada.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
  );
  document
    .querySelectorAll("[data-revelar]")
    .forEach((el) => observadorRevelar.observe(el));
});

/* =========================================================
   CARROSSEL DA SEÇÃO SOBRE
   A troca automática acontece quando a barrinha de progresso
   do ponto ativo termina de encher (animação CSS de 10s).
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  const secao = document.querySelector(".secaoSobre");
  const cartoes = document.querySelectorAll(".cartao");
  const pontos = document.querySelectorAll(".ponto");
  if (!secao || !cartoes.length) return;

  let indexAtual = 0;
  const totalSlides = cartoes.length;
  const tempoIntervalo = 10000;
  const movimentoReduzido = matchMedia("(prefers-reduced-motion: reduce)");
  let temporizadorAnimacao;

  function irParaSlide(index) {
    cartoes[indexAtual].classList.remove("ativo");
    pontos[indexAtual].classList.remove("ativo");

    indexAtual = (index + totalSlides) % totalSlides;

    // Força o navegador a reiniciar a animação da barrinha
    void pontos[indexAtual].offsetWidth;

    cartoes[indexAtual].classList.add("ativo");
    pontos[indexAtual].classList.add("ativo");
  }

  function proximoSlide() {
    irParaSlide(indexAtual + 1);
  }

  // Avança quando a barrinha termina
  pontos.forEach((ponto) => {
    ponto.addEventListener("animationend", (e) => {
      if (e.animationName === "progressoSlide" && ponto.classList.contains("ativo")) {
        proximoSlide();
      }
    });
  });

  // Com "movimento reduzido" não há barrinha animada: usa um temporizador
  function reiniciarTemporizador() {
    clearInterval(temporizadorAnimacao);
    if (movimentoReduzido.matches) {
      temporizadorAnimacao = setInterval(proximoSlide, tempoIntervalo);
    }
  }

  pontos.forEach((ponto, index) => {
    ponto.addEventListener("click", () => {
      irParaSlide(index);
      reiniciarTemporizador();
    });
  });

  // Teclado: setas esquerda/direita quando o foco está nos pontos
  secao.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    irParaSlide(indexAtual + (e.key === "ArrowRight" ? 1 : -1));
    pontos[indexAtual].focus();
    reiniciarTemporizador();
  });

  // Arrastar no celular
  let toqueInicioX = null;
  secao.addEventListener(
    "touchstart",
    (e) => (toqueInicioX = e.touches[0].clientX),
    { passive: true },
  );
  secao.addEventListener("touchend", (e) => {
    if (toqueInicioX === null) return;
    const distancia = e.changedTouches[0].clientX - toqueInicioX;
    toqueInicioX = null;
    if (Math.abs(distancia) < 50) return;
    irParaSlide(indexAtual + (distancia < 0 ? 1 : -1));
    reiniciarTemporizador();
  });

  // Pausa com o mouse em cima (só em computadores)
  if (matchMedia("(hover: hover)").matches) {
    secao.addEventListener("mouseenter", () => secao.classList.add("pausado"));
    secao.addEventListener("mouseleave", () => secao.classList.remove("pausado"));
  }

  // Pausa enquanto a seção não está visível na tela
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entrada]) => secao.classList.toggle("fora", !entrada.isIntersecting),
      { threshold: 0.3 },
    ).observe(secao);
  }

  movimentoReduzido.addEventListener("change", reiniciarTemporizador);
  reiniciarTemporizador();
});

/* Scroll Linked seção endereço */

(() => {
  "use strict";
  const section = document.querySelector("#local");
  const video = section?.querySelector("#localVideo");
  const sticky = section?.querySelector(".localSticky");
  const panel = section?.querySelector(".fundoVidro");
  if (!section || !video || !sticky || !panel) return;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const FPS = 60; // FPS do MP4 fornecido.
  const SUAVIZACAO_MS = 110; // Menor = mais direto; maior = mais atraso.
  const EPSILON = 1 / (FPS * 2);
  let active = false;
  let failed = false;
  let ready = false;
  let raf = 0;
  let previousTimestamp = 0;
  let smoothTime = 0;
  let lastFrameTime = 0;
  let topOffset = 0;
  let travel = 1;

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function wake() {
    if (active && ready && !document.hidden && !raf) {
      raf = requestAnimationFrame(update);
    }
  }

  function update(timestamp) {
    raf = 0;
    if (!active || !ready || document.hidden) return;
    // Um seek por vez: não interrompa a decodificação com outro pedido.
    // O evento "seeked" retoma o trabalho quando o quadro estiver pronto.
    if (video.seeking) return;

    const rect = section.getBoundingClientRect();
    const progress = clamp((topOffset - rect.top) / travel, 0, 1);
    const targetTime = progress * lastFrameTime;
    const dt = previousTimestamp
      ? Math.min(timestamp - previousTimestamp, 64)
      : 1000 / FPS;
    previousTimestamp = timestamp;
    // Interpolação independente da taxa de atualização da tela.
    const alpha = 1 - Math.exp(-dt / SUAVIZACAO_MS);
    smoothTime += (targetTime - smoothTime) * alpha;
    if (Math.abs(targetTime - smoothTime) < EPSILON) smoothTime = targetTime;

    const frameTime = clamp(
      Math.round(smoothTime * FPS) / FPS,
      0,
      lastFrameTime,
    );
    if (Math.abs(video.currentTime - frameTime) > EPSILON) {
      video.currentTime = frameTime;
    }
    if (Math.abs(targetTime - smoothTime) >= EPSILON) wake();
  }

  function measure() {
    topOffset = parseFloat(getComputedStyle(sticky).top) || 0;
    const css = getComputedStyle(sticky);
    const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
    // Em telas muito baixas ou com texto ampliado, evite conteúdo preso fora da tela.
    const fits =
      panel.getBoundingClientRect().height + padding <=
      innerHeight - topOffset + 1;
    active = !reducedMotion.matches && !failed && fits;
    section.classList.toggle("is-scrubbing", active);
    travel = Math.max(1, section.offsetHeight - sticky.offsetHeight);

    if (!active) {
      cancelAnimationFrame(raf);
      raf = 0;
      previousTimestamp = 0;
      video.pause();
      return;
    }
    if (!video.getAttribute("src")) {
      // Sem download do MP4 se o usuário preferir movimento reduzido.
      video.muted = true;
      video.src = video.dataset.src;
      video.load();
    }
    wake(); // está vazio 
  }

  function mediaReady() {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    lastFrameTime = Math.max(0, video.duration - 1 / FPS);
    ready = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (ready) wake();
  }

  video.addEventListener("loadedmetadata", mediaReady);
  video.addEventListener("loadeddata", mediaReady);
  video.addEventListener("canplay", mediaReady);
  video.addEventListener("seeked", wake);
  video.addEventListener("error", () => {
    failed = true;
    measure();
  });
  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", measure, { passive: true });
  window.addEventListener("pageshow", measure);
  reducedMotion.addEventListener("change", measure);
  document.addEventListener("visibilitychange", () => {
    previousTimestamp = 0;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  });
  if ("ResizeObserver" in window) new ResizeObserver(measure).observe(panel);
  measure();
})();
