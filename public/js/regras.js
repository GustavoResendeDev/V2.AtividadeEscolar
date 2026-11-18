/* Regras de funcionamento da Nova Era Barbearia.
   Fonte única: o navegador carrega este arquivo com <script> e o servidor com require().
   Tudo é calculado no horário de Brasília, independente do fuso de quem acessa. */
(function (raiz, fabrica) {
  const regras = fabrica();
  if (typeof module === "object" && module.exports) module.exports = regras;
  else Object.assign(raiz, regras);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FUNCIONAMENTO = {
    fuso: "America/Sao_Paulo",
    diasAbertos: [1, 2, 3, 4, 5, 6], // 0 = domingo ... 6 = sábado
    abre: 8 * 60, // 8h00, em minutos
    fecha: 19 * 60, // 19h00, em minutos
    intervaloGrade: 30, // horários oferecidos de 30 em 30 minutos
    antecedenciaMaximaDias: 60, // até quantos dias à frente se pode agendar
    // Feriados nacionais fixos (MM-DD). Acrescente aqui feriados locais, se fechar neles.
    feriadosFixos: ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"],
  };

  const doisDigitos = (n) => String(n).padStart(2, "0");

  // Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), usado para a Sexta-feira Santa.
  function pascoa(ano) {
    const a = ano % 19;
    const b = Math.floor(ano / 100);
    const c = ano % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(ano, mes - 1, dia));
  }

  function eFeriado(ano, mes, dia) {
    const mmdd = `${doisDigitos(mes)}-${doisDigitos(dia)}`;
    if (FUNCIONAMENTO.feriadosFixos.includes(mmdd)) return true;

    const sextaSanta = pascoa(ano);
    sextaSanta.setUTCDate(sextaSanta.getUTCDate() - 2);
    return sextaSanta.getUTCMonth() + 1 === mes && sextaSanta.getUTCDate() === dia;
  }

  function agoraEmBrasilia(agora = new Date()) {
    const partes = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: FUNCIONAMENTO.fuso,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hourCycle: "h23",
      })
        .formatToParts(agora)
        .map((p) => [p.type, Number(p.value)])
    );
    const { year: ano, month: mes, day: dia, hour: hora, minute: minuto } = partes;
    const diaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
    return { ano, mes, dia, diaSemana, minutos: hora * 60 + minuto };
  }

  function hojeISO(agora = new Date()) {
    const { ano, mes, dia } = agoraEmBrasilia(agora);
    return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
  }

  function somarDias(iso, dias) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia + dias));
    return data.toISOString().slice(0, 10);
  }

  function dataValida(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const [ano, mes, dia] = iso.split("-").map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return data.getUTCFullYear() === ano && data.getUTCMonth() + 1 === mes && data.getUTCDate() === dia;
  }

  function paraMinutos(hhmm) {
    if (typeof hhmm !== "string" || !/^\d{2}:\d{2}$/.test(hhmm)) return NaN;
    const [h, m] = hhmm.split(":").map(Number);
    if (h > 23 || m > 59) return NaN;
    return h * 60 + m;
  }

  function paraHora(minutos) {
    return `${doisDigitos(Math.floor(minutos / 60))}:${doisDigitos(minutos % 60)}`;
  }

  // Motivo pelo qual a barbearia não abre na data, ou "" se abre.
  function motivoDataFechada(iso) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    const diaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
    if (!FUNCIONAMENTO.diasAbertos.includes(diaSemana)) return "Não abrimos aos domingos.";
    if (eFeriado(ano, mes, dia)) return "Estaremos fechados nesse dia (feriado).";
    return "";
  }

  function estaAberto(agora = new Date()) {
    const { ano, mes, dia, diaSemana, minutos } = agoraEmBrasilia(agora);
    return (
      FUNCIONAMENTO.diasAbertos.includes(diaSemana) &&
      !eFeriado(ano, mes, dia) &&
      minutos >= FUNCIONAMENTO.abre &&
      minutos < FUNCIONAMENTO.fecha
    );
  }

  // Horários de início possíveis para um serviço de `duracao` minutos (sem olhar a agenda).
  function gradeDeHorarios(duracao) {
    const horarios = [];
    for (let m = FUNCIONAMENTO.abre; m + duracao <= FUNCIONAMENTO.fecha; m += FUNCIONAMENTO.intervaloGrade) {
      horarios.push(m);
    }
    return horarios;
  }

  // Dois intervalos [inicio, fim) se sobrepõem?
  function sobrepoe(inicioA, fimA, inicioB, fimB) {
    return inicioA < fimB && inicioB < fimA;
  }

  return {
    FUNCIONAMENTO,
    pascoa,
    eFeriado,
    agoraEmBrasilia,
    hojeISO,
    somarDias,
    dataValida,
    paraMinutos,
    paraHora,
    motivoDataFechada,
    estaAberto,
    gradeDeHorarios,
    sobrepoe,
  };
});
