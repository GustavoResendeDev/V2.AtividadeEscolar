/* Status de funcionamento (bolinha do hero): verde = aberto, vermelho = fechado.
   As regras (horário, feriados, fuso de Brasília) vêm de regras.js. */
function iniciarStatusFuncionamento() {
  const etiqueta = document.getElementById("statusFuncionamento");
  if (!etiqueta) return;
  const texto = document.getElementById("statusTexto");

  function atualizar() {
    const aberto = estaAberto();
    etiqueta.dataset.status = aberto ? "aberto" : "fechado";
    if (texto) texto.textContent = aberto ? "Aberto agora. " : "Fechado agora. ";
  }

  // Atualiza na virada de cada minuto e ao voltar para a aba.
  function agendar() {
    atualizar();
    setTimeout(agendar, 60000 - (Date.now() % 60000) + 50);
  }
  agendar();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) atualizar();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  iniciarStatusFuncionamento();

  const header = document.querySelector("header");
  const linksMenu = document.querySelectorAll(".menu a[href^='#']");

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

  window.addEventListener(
    "scroll",
    () => {
      if (secoes[0] && secoes[0].getBoundingClientRect().top > innerHeight * 0.5) {
        linksMenu.forEach((link) => link.classList.remove("atual"));
      }
    },
    { passive: true },
  );

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

    void pontos[indexAtual].offsetWidth;

    cartoes[indexAtual].classList.add("ativo");
    pontos[indexAtual].classList.add("ativo");
  }

  function proximoSlide() {
    irParaSlide(indexAtual + 1);
  }

  pontos.forEach((ponto) => {
    ponto.addEventListener("animationend", (e) => {
      if (e.animationName === "progressoSlide" && ponto.classList.contains("ativo")) {
        proximoSlide();
      }
    });
  });

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

  secao.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    irParaSlide(indexAtual + (e.key === "ArrowRight" ? 1 : -1));
    pontos[indexAtual].focus();
    reiniciarTemporizador();
  });

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

  if (matchMedia("(hover: hover)").matches) {
    secao.addEventListener("mouseenter", () => secao.classList.add("pausado"));
    secao.addEventListener("mouseleave", () => secao.classList.remove("pausado"));
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entrada]) => secao.classList.toggle("fora", !entrada.isIntersecting),
      { threshold: 0.3 },
    ).observe(secao);
  }

  movimentoReduzido.addEventListener("change", reiniciarTemporizador);
  reiniciarTemporizador();
});

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
    if (video.seeking) return;

    const rect = section.getBoundingClientRect();
    const progress = clamp((topOffset - rect.top) / travel, 0, 1);
    const targetTime = progress * lastFrameTime;
    const dt = previousTimestamp
      ? Math.min(timestamp - previousTimestamp, 64)
      : 1000 / FPS;
    previousTimestamp = timestamp;
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
