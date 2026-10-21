document.addEventListener("DOMContentLoaded", () => {
  const cartoes = document.querySelectorAll(".cartao");
  const pontos = document.querySelectorAll(".ponto");
  const btnAnterior = document.querySelector(".nav-anterior");
  const btnProximo = document.querySelector(".nav-proximo");

  let indexAtual = 0;
  const totalSlides = cartoes.length;

  const tempoIntervalo = 10000;
  let temporizadorAnimacao;

  function irParaSlide(index) {
    cartoes[indexAtual].classList.remove("ativo");
    pontos[indexAtual].classList.remove("ativo");

    indexAtual = (index + totalSlides) % totalSlides;

    cartoes[indexAtual].classList.add("ativo");
    pontos[indexAtual].classList.add("ativo");
  }

  function proximoSlideAutom() {
    irParaSlide(indexAtual + 1);
  }

  function cliqueManual(index) {
    irParaSlide(index);
    reiniciarTemporizador();
  }

  pontos.forEach((ponto, index) => {
    ponto.addEventListener("click", () => cliqueManual(index));
  });

  function reiniciarTemporizador() {
    clearInterval(temporizadorAnimacao);
    temporizadorAnimacao = setInterval(proximoSlideAutom, tempoIntervalo);
  }

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
    wake();
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
