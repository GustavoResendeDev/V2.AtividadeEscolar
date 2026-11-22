/* Regras de negócio da agenda: horários livres, criação de agendamentos sem conflito,
   mudança de status e anonimização de dados antigos (LGPD). Banco: PostgreSQL (server/banco.js). */
const regras = require("../public/js/regras.js");

// Status que ocupam a cadeira do barbeiro. Cancelado libera o horário.
const STATUS_OCUPAM = ["pendente", "confirmado", "concluido", "faltou"];
const SQL_OCUPAM = STATUS_OCUPAM.map((s) => `'${s}'`).join(", ");

// Para onde cada status pode ir (máquina de estados do atendimento).
const TRANSICOES = {
  pendente: ["confirmado", "cancelado"],
  confirmado: ["concluido", "faltou", "cancelado"],
  concluido: [],
  cancelado: [],
  faltou: [],
};

const DIAS_RETENCAO = 180; // depois disso, nome e telefone do cliente são anonimizados

class ErroNegocio extends Error {
  constructor(status, mensagem, campo) {
    super(mensagem);
    this.status = status;
    this.campo = campo;
  }
}

function normalizarTelefone(valor) {
  let digitos = String(valor || "").replace(/\D/g, "");
  if (digitos.length === 13 && digitos.startsWith("55")) digitos = digitos.slice(2);
  // DDD (11 a 99) + celular com 9 dígitos começando por 9, ou fixo com 8 dígitos.
  if (!/^[1-9][1-9](9\d{8}|[2-5]\d{7})$/.test(digitos)) return null;
  return digitos;
}

function formatarTelefone(digitos) {
  if (!digitos) return "";
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  const corte = numero.length === 9 ? 5 : 4;
  return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
}

// Código de 8 caracteres hexadecimais (ex.: 3F9A01BC) mostrado ao cliente.
function gerarCodigo() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Id inteiro positivo vindo da URL ou do corpo; qualquer outra coisa vira null.
const idValido = (valor) => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
};

/* Trava a agenda de um dia até o fim da transação: dois clientes não conseguem
   pegar o mesmo horário ao mesmo tempo, mesmo vindo de servidores diferentes. */
const travarDia = (tx, data) => tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`agenda:${data}`]);

function criarAgenda(db, { agora = () => new Date() } = {}) {
  async function servicosAtivos() {
    return db.query(
      "SELECT id, nome, categoria, duracao_min, preco_centavos FROM servicos WHERE ativo ORDER BY id"
    );
  }

  const listarServicos = servicosAtivos;

  async function listarBarbeiros(q = db) {
    return q.query("SELECT id, nome, especialidade FROM barbeiros WHERE ativo ORDER BY id");
  }

  async function barbeiroAtivo(id, q = db) {
    const n = idValido(id);
    return n ? q.um("SELECT id, nome, especialidade FROM barbeiros WHERE id = $1 AND ativo", [n]) : null;
  }

  const MAX_SERVICOS = 5;

  /* Lista de serviços do pedido: aceita servicoIds (vários) ou servicoId (um só).
     Devolve os serviços na ordem escolhida, com a duração e o preço somados. */
  async function servicosDoPedido({ servicoIds, servicoId }) {
    let ids = Array.isArray(servicoIds) ? servicoIds : servicoId != null && servicoId !== "" ? [servicoId] : [];
    ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) throw new ErroNegocio(422, "Escolha pelo menos um serviço.", "servico");
    if (ids.length > MAX_SERVICOS)
      throw new ErroNegocio(422, `Escolha no máximo ${MAX_SERVICOS} serviços por agendamento.`, "servico");
    const ativos = new Map((await servicosAtivos()).map((s) => [s.id, s]));
    const lista = ids.map((id) => {
      const servico = ativos.get(id);
      if (!servico) throw new ErroNegocio(422, "Um dos serviços escolhidos não está disponível.", "servico");
      return servico;
    });
    const duracao = lista.reduce((t, s) => t + s.duracao_min, 0);
    const { abre, fecha } = regras.FUNCIONAMENTO;
    if (duracao > fecha - abre)
      throw new ErroNegocio(422, "Os serviços escolhidos não cabem num mesmo dia. Divida em dois agendamentos.", "servico");
    return {
      lista,
      duracao,
      preco: lista.reduce((t, s) => t + s.preco_centavos, 0),
      nome: lista.map((s) => s.nome).join(", "),
    };
  }

  async function gravarServicos(tx, agendamentoId, servicos) {
    for (const [i, s] of servicos.lista.entries()) {
      await tx.query(
        `INSERT INTO agendamento_servicos (agendamento_id, servico_id, ordem, duracao_min, preco_centavos)
         VALUES ($1, $2, $3, $4, $5)`,
        [agendamentoId, s.id, i + 1, s.duracao_min, s.preco_centavos]
      );
    }
  }

  // Confere se a data pode receber agendamentos; lança ErroNegocio se não puder.
  function validarData(data) {
    if (!regras.dataValida(data)) throw new ErroNegocio(422, "Escolha uma data válida.", "data");
    const hoje = regras.hojeISO(agora());
    if (data < hoje) throw new ErroNegocio(422, "Escolha uma data a partir de hoje.", "data");
    const limite = regras.somarDias(hoje, regras.FUNCIONAMENTO.antecedenciaMaximaDias);
    if (data > limite)
      throw new ErroNegocio(
        422,
        `Agendamos com até ${regras.FUNCIONAMENTO.antecedenciaMaximaDias} dias de antecedência.`,
        "data"
      );
    const motivo = regras.motivoDataFechada(data);
    if (motivo) throw new ErroNegocio(422, motivo, "data");
  }

  // Horários ocupados no dia, agrupados por barbeiro: Map(barbeiroId -> [{inicio_min, fim_min}]).
  async function ocupacoesDoDia(q, data) {
    const linhas = await q.query(
      `SELECT barbeiro_id, inicio_min, fim_min FROM agendamentos WHERE data = $1 AND status IN (${SQL_OCUPAM})`,
      [data]
    );
    const mapa = new Map();
    for (const l of linhas) {
      if (!mapa.has(l.barbeiro_id)) mapa.set(l.barbeiro_id, []);
      mapa.get(l.barbeiro_id).push(l);
    }
    return mapa;
  }

  const livre = (ocupados = [], inicio, fim) =>
    !ocupados.some((o) => regras.sobrepoe(inicio, fim, o.inicio_min, o.fim_min));

  // Horário que já passou (hoje) não pode ser escolhido.
  function minutoMinimo(data) {
    const atual = regras.agoraEmBrasilia(agora());
    return data === regras.hojeISO(agora()) ? atual.minutos + 1 : 0;
  }

  /* Horários de início do serviço na data. Com barbeiro, olha só a agenda dele;
     sem barbeiro ("sem preferência"), o horário está livre se algum barbeiro estiver livre. */
  async function disponibilidade({ data, servicoId, servicoIds, barbeiroId }) {
    validarData(data);
    const { duracao } = await servicosDoPedido({ servicoIds, servicoId });

    let barbeiros;
    if (barbeiroId) {
      const barbeiro = await barbeiroAtivo(barbeiroId);
      if (!barbeiro) throw new ErroNegocio(422, "Escolha um barbeiro válido.", "barbeiro");
      barbeiros = [barbeiro];
    } else {
      barbeiros = await listarBarbeiros();
    }

    const ocupacoes = await ocupacoesDoDia(db, data);
    const agendas = barbeiros.map((b) => ocupacoes.get(b.id) || []);
    const minimo = minutoMinimo(data);
    return regras
      .gradeDeHorarios(duracao)
      .filter((inicio) => inicio >= minimo)
      .map((inicio) => ({
        hora: regras.paraHora(inicio),
        disponivel: agendas.some((ocupados) => livre(ocupados, inicio, inicio + duracao)),
      }));
  }

  async function validarPedido(pedido) {
    const nome = String(pedido.nome || "").trim().replace(/\s+/g, " ");
    if (nome.length < 3) throw new ErroNegocio(422, "Informe seu nome (pelo menos 3 letras).", "nome");
    if (nome.length > 80) throw new ErroNegocio(422, "O nome pode ter no máximo 80 letras.", "nome");
    const telefone = normalizarTelefone(pedido.telefone);
    if (!telefone) throw new ErroNegocio(422, "Informe um WhatsApp válido, com DDD.", "telefone");
    if (pedido.consentimento !== true)
      throw new ErroNegocio(422, "Para agendar, aceite a Política de Privacidade.", "consentimento");

    const servicos = await servicosDoPedido(pedido);
    validarData(pedido.data);

    const inicio = regras.paraMinutos(pedido.hora);
    if (Number.isNaN(inicio)) throw new ErroNegocio(422, "Escolha um horário.", "hora");
    const fim = inicio + servicos.duracao;
    const { abre, fecha, intervaloGrade } = regras.FUNCIONAMENTO;
    if (inicio < abre || (inicio - abre) % intervaloGrade !== 0)
      throw new ErroNegocio(422, "Esse horário está fora do nosso funcionamento.", "hora");
    if (fim > fecha)
      throw new ErroNegocio(422, "Os serviços escolhidos terminariam depois das 19h. Escolha um horário mais cedo.", "hora");
    if (inicio < minutoMinimo(pedido.data))
      throw new ErroNegocio(422, "Esse horário já passou. Escolha outro.", "hora");

    let barbeiro = null;
    if (pedido.barbeiroId) {
      barbeiro = await barbeiroAtivo(pedido.barbeiroId);
      if (!barbeiro) throw new ErroNegocio(422, "Escolha um barbeiro válido.", "barbeiro");
    }
    return { nome, telefone, servicos, barbeiro, inicio, fim, data: pedido.data };
  }

  // Sem preferência: o barbeiro livre com menos atendimentos no dia (divide o trabalho).
  async function escolherBarbeiro(tx, data, inicio, fim) {
    const ocupacoes = await ocupacoesDoDia(tx, data);
    const candidatos = (await listarBarbeiros(tx))
      .map((b) => ({ ...b, ocupados: ocupacoes.get(b.id) || [] }))
      .filter((b) => livre(b.ocupados, inicio, fim))
      .sort((a, b) => a.ocupados.length - b.ocupados.length || a.id - b.id);
    return candidatos[0] || null;
  }

  async function barbeiroLivre(tx, data, barbeiroId, inicio, fim, ignorarId = 0) {
    const choque = await tx.um(
      `SELECT 1 FROM agendamentos
        WHERE data = $1 AND barbeiro_id = $2 AND id <> $3 AND status IN (${SQL_OCUPAM})
          AND inicio_min < $4 AND $5 < fim_min
        LIMIT 1`,
      [data, barbeiroId, ignorarId, fim, inicio]
    );
    return !choque;
  }

  async function inserirAgendamento(tx, { clienteId, servicos, barbeiroId, data, inicio, fim, status, usuarioId }) {
    const { id } = await tx.um(
      `INSERT INTO agendamentos
         (codigo, cliente_id, servico_id, barbeiro_id, data, inicio_min, fim_min, preco_centavos, status, consentimento_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       RETURNING id`,
      [gerarCodigo(), clienteId, servicos.lista[0].id, barbeiroId, data, inicio, fim, servicos.preco, status]
    );
    await gravarServicos(tx, id, servicos);
    await tx.query("INSERT INTO historico_status (agendamento_id, de, para, usuario_id) VALUES ($1, NULL, $2, $3)", [
      id,
      status,
      usuarioId,
    ]);
    return buscar(id, tx);
  }

  async function criarAgendamento(pedido) {
    const p = await validarPedido(pedido);

    return db.transacao(async (tx) => {
      await travarDia(tx, p.data);
      let barbeiro = p.barbeiro;
      if (barbeiro) {
        if (!(await barbeiroLivre(tx, p.data, barbeiro.id, p.inicio, p.fim)))
          throw new ErroNegocio(409, "Esse horário acabou de ser reservado. Escolha outro.", "hora");
      } else {
        barbeiro = await escolherBarbeiro(tx, p.data, p.inicio, p.fim);
        if (!barbeiro)
          throw new ErroNegocio(409, "Nenhum barbeiro está livre nesse horário. Escolha outro.", "hora");
      }

      const cliente = await tx.um(
        `INSERT INTO clientes (nome, telefone) VALUES ($1, $2)
         ON CONFLICT (telefone) DO UPDATE SET nome = excluded.nome
         RETURNING id`,
        [p.nome, p.telefone]
      );
      return inserirAgendamento(tx, {
        clienteId: cliente.id,
        servicos: p.servicos,
        barbeiroId: barbeiro.id,
        data: p.data,
        inicio: p.inicio,
        fim: p.fim,
        status: "pendente",
        usuarioId: null,
      });
    });
  }

  const SELECT_AGENDAMENTO = `
    SELECT a.id, a.codigo, a.data, a.inicio_min, a.fim_min, a.preco_centavos, a.status,
           c.nome AS cliente_nome, c.telefone AS cliente_telefone,
           s.id AS servico_id,
           COALESCE(
             (SELECT string_agg(s2.nome, ', ' ORDER BY x.ordem)
                FROM agendamento_servicos x JOIN servicos s2 ON s2.id = x.servico_id
               WHERE x.agendamento_id = a.id),
             s.nome) AS servico_nome,
           (SELECT COUNT(*)::int FROM agendamento_servicos x WHERE x.agendamento_id = a.id) AS qtd_servicos,
           b.id AS barbeiro_id, b.nome AS barbeiro_nome
      FROM agendamentos a
      JOIN clientes  c ON c.id = a.cliente_id
      JOIN servicos  s ON s.id = a.servico_id
      JOIN barbeiros b ON b.id = a.barbeiro_id`;

  function formatar(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      codigo: linha.codigo,
      data: linha.data,
      hora: regras.paraHora(linha.inicio_min),
      termino: regras.paraHora(linha.fim_min),
      preco: linha.preco_centavos / 100,
      status: linha.status,
      cliente: {
        nome: linha.cliente_nome,
        telefone: formatarTelefone(linha.cliente_telefone),
        whatsapp: linha.cliente_telefone ? `55${linha.cliente_telefone}` : null,
      },
      servico: { id: linha.servico_id, nome: linha.servico_nome, quantidade: Math.max(1, linha.qtd_servicos) },
      barbeiro: { id: linha.barbeiro_id, nome: linha.barbeiro_nome },
      proximosStatus: TRANSICOES[linha.status],
    };
  }

  async function buscar(id, q = db) {
    const n = idValido(id);
    return n ? formatar(await q.um(`${SELECT_AGENDAMENTO} WHERE a.id = $1`, [n])) : null;
  }

  const MAX_DIAS_PERIODO = 93; // um trimestre: suficiente para a visão mensal e relatórios

  // Período [inicio, fim] (datas ISO, inclusivas). Aceita `data` sozinha para um único dia.
  function periodo({ data, inicio, fim }) {
    if (data && !inicio && !fim) inicio = fim = data;
    if (!regras.dataValida(inicio) || !regras.dataValida(fim)) throw new ErroNegocio(422, "Data inválida.", "data");
    if (fim < inicio) throw new ErroNegocio(422, "A data final vem antes da inicial.", "data");
    if (fim > regras.somarDias(inicio, MAX_DIAS_PERIODO))
      throw new ErroNegocio(422, `Escolha um período de até ${MAX_DIAS_PERIODO} dias.`, "data");
    return { inicio, fim };
  }

  async function listar({ data, inicio, fim, barbeiroId, status }) {
    const p = periodo({ data, inicio, fim });
    const filtros = ["a.data BETWEEN $1 AND $2"];
    const valores = [p.inicio, p.fim];
    if (barbeiroId) {
      valores.push(idValido(barbeiroId) || 0);
      filtros.push(`a.barbeiro_id = $${valores.length}`);
    }
    if (status) {
      if (!TRANSICOES[status]) throw new ErroNegocio(422, "Status inválido.", "status");
      valores.push(status);
      filtros.push(`a.status = $${valores.length}`);
    }
    const linhas = await db.query(
      `${SELECT_AGENDAMENTO} WHERE ${filtros.join(" AND ")} ORDER BY a.data, a.inicio_min, b.nome`,
      valores
    );
    return linhas.map(formatar);
  }

  function resumoDe(lista) {
    const contar = (s) => lista.filter((a) => a.status === s).length;
    const somar = (estados) =>
      lista.filter((a) => estados.includes(a.status)).reduce((total, a) => total + a.preco, 0);
    return {
      total: lista.filter((a) => a.status !== "cancelado").length,
      pendentes: contar("pendente"),
      confirmados: contar("confirmado"),
      concluidos: contar("concluido"),
      cancelados: contar("cancelado"),
      faltas: contar("faltou"),
      faturamentoPrevisto: somar(["pendente", "confirmado", "concluido"]),
      faturamentoRealizado: somar(["concluido"]),
    };
  }

  async function resumo(filtro) {
    return resumoDe(await listar({ ...filtro, status: null }));
  }

  /* Relatório por barbeiro no período: quantas pessoas cada um atendeu (concluídos),
     além de agendados, faltas, cancelados e faturamento. Barbeiros sem movimento aparecem com zero. */
  async function relatorio({ inicio, fim, barbeiroId }) {
    const p = periodo({ inicio, fim });
    const valores = [p.inicio, p.fim];
    let filtroBarbeiro = "";
    if (barbeiroId) {
      valores.push(idValido(barbeiroId) || 0);
      filtroBarbeiro = "AND b.id = $3";
    }
    const linhas = await db.query(
      `SELECT b.id, b.nome,
              COUNT(CASE WHEN a.status = 'concluido' THEN 1 END)::int  AS atendidos,
              COUNT(CASE WHEN a.status IN ('pendente', 'confirmado') THEN 1 END)::int AS aguardando,
              COUNT(CASE WHEN a.status = 'faltou' THEN 1 END)::int     AS faltas,
              COUNT(CASE WHEN a.status = 'cancelado' THEN 1 END)::int  AS cancelados,
              COUNT(DISTINCT CASE WHEN a.status = 'concluido' THEN a.cliente_id END)::int AS clientes_unicos,
              COALESCE(SUM(CASE WHEN a.status = 'concluido' THEN a.preco_centavos END), 0)::int AS faturado,
              COALESCE(SUM(CASE WHEN a.status = 'concluido' THEN a.fim_min - a.inicio_min END), 0)::int AS minutos
         FROM barbeiros b
         LEFT JOIN agendamentos a ON a.barbeiro_id = b.id AND a.data BETWEEN $1 AND $2
        WHERE b.ativo ${filtroBarbeiro}
        GROUP BY b.id, b.nome
        ORDER BY atendidos DESC, b.nome`,
      valores
    );

    const barbeiros = linhas.map((l) => {
      const compareceram = l.atendidos + l.faltas;
      return {
        id: l.id,
        nome: l.nome,
        atendidos: l.atendidos,
        clientesUnicos: l.clientes_unicos,
        aguardando: l.aguardando,
        faltas: l.faltas,
        cancelados: l.cancelados,
        faturado: l.faturado / 100,
        ticketMedio: l.atendidos ? l.faturado / 100 / l.atendidos : 0,
        horasTrabalhadas: Math.round((l.minutos / 60) * 10) / 10,
        comparecimento: compareceram ? Math.round((l.atendidos / compareceram) * 100) : null,
      };
    });
    const soma = (campo) => barbeiros.reduce((t, b) => t + b[campo], 0);
    return {
      inicio: p.inicio,
      fim: p.fim,
      geradoEm: agora().toISOString(),
      barbeiros,
      totais: {
        atendidos: soma("atendidos"),
        aguardando: soma("aguardando"),
        faltas: soma("faltas"),
        cancelados: soma("cancelados"),
        faturado: Math.round(soma("faturado") * 100) / 100,
        horasTrabalhadas: Math.round(soma("horasTrabalhadas") * 10) / 10,
      },
    };
  }

  /* Regras de horário para a equipe (agendamento manual e remarcação):
     dia aberto, de hoje até 1 ano à frente, dentro do expediente e na grade de 30 minutos.
     Horários já passados de hoje são aceitos, para registrar quem foi atendido sem marcar. */
  function validarHorarioEquipe(data, hora, duracao) {
    if (!regras.dataValida(data)) throw new ErroNegocio(422, "Escolha uma data válida.", "data");
    const hoje = regras.hojeISO(agora());
    if (data < hoje) throw new ErroNegocio(422, "Não é possível agendar em dias que já passaram.", "data");
    if (data > regras.somarDias(hoje, 366)) throw new ErroNegocio(422, "Agende com até 1 ano de antecedência.", "data");
    const motivo = regras.motivoDataFechada(data);
    if (motivo) throw new ErroNegocio(422, motivo, "data");
    const inicio = regras.paraMinutos(hora);
    if (Number.isNaN(inicio)) throw new ErroNegocio(422, "Escolha um horário.", "hora");
    const fim = inicio + duracao;
    const { abre, fecha, intervaloGrade } = regras.FUNCIONAMENTO;
    if (inicio < abre || fim > fecha || (inicio - abre) % intervaloGrade !== 0)
      throw new ErroNegocio(422, "Esse horário está fora do expediente.", "hora");
    return { inicio, fim };
  }

  // Barbeiro só agenda para si; administrador escolhe (ou deixa o sistema escolher).
  async function barbeiroDaEquipe(pedidoId, usuario) {
    const id = usuario.papel === "barbeiro" ? usuario.barbeiro_id : pedidoId;
    if (!id) return null;
    const barbeiro = await barbeiroAtivo(id);
    if (!barbeiro) throw new ErroNegocio(422, "Escolha um barbeiro válido.", "barbeiro");
    return barbeiro;
  }

  /* Agendamento feito pela equipe (telefone, balcão, encaixe). Já nasce confirmado.
     O telefone é opcional: sem ele, o cliente fica registrado só pelo nome. */
  async function criarManual(pedido, usuario) {
    const nome = String(pedido.nome || "").trim().replace(/\s+/g, " ");
    if (nome.length < 2) throw new ErroNegocio(422, "Informe o nome do cliente.", "nome");
    if (nome.length > 80) throw new ErroNegocio(422, "O nome pode ter no máximo 80 letras.", "nome");
    let telefone = null;
    if (String(pedido.telefone || "").trim()) {
      telefone = normalizarTelefone(pedido.telefone);
      if (!telefone) throw new ErroNegocio(422, "Telefone inválido. Use DDD + número.", "telefone");
    }
    const servicos = await servicosDoPedido(pedido);
    const { inicio, fim } = validarHorarioEquipe(pedido.data, pedido.hora, servicos.duracao);
    const escolhido = await barbeiroDaEquipe(pedido.barbeiroId, usuario);
    const status = pedido.status === "concluido" ? "concluido" : "confirmado";

    return db.transacao(async (tx) => {
      await travarDia(tx, pedido.data);
      let barbeiro = escolhido;
      if (barbeiro) {
        if (!(await barbeiroLivre(tx, pedido.data, barbeiro.id, inicio, fim)))
          throw new ErroNegocio(409, `${barbeiro.nome} já tem atendimento nesse horário.`, "hora");
      } else {
        barbeiro = await escolherBarbeiro(tx, pedido.data, inicio, fim);
        if (!barbeiro) throw new ErroNegocio(409, "Nenhum barbeiro está livre nesse horário.", "hora");
      }

      const cliente = telefone
        ? await tx.um(
            `INSERT INTO clientes (nome, telefone) VALUES ($1, $2)
             ON CONFLICT (telefone) DO UPDATE SET nome = excluded.nome RETURNING id`,
            [nome, telefone]
          )
        : await tx.um("INSERT INTO clientes (nome, telefone) VALUES ($1, NULL) RETURNING id", [nome]);

      return inserirAgendamento(tx, {
        clienteId: cliente.id,
        servicos,
        barbeiroId: barbeiro.id,
        data: pedido.data,
        inicio,
        fim,
        status,
        usuarioId: usuario.id,
      });
    });
  }

  async function carregarParaAlterar(tx, id, usuario) {
    const n = idValido(id);
    const atual = n
      ? await tx.um("SELECT id, status, barbeiro_id, inicio_min, fim_min FROM agendamentos WHERE id = $1 FOR UPDATE", [n])
      : null;
    if (!atual) throw new ErroNegocio(404, "Agendamento não encontrado.");
    if (usuario.papel === "barbeiro" && atual.barbeiro_id !== usuario.barbeiro_id)
      throw new ErroNegocio(403, "Você só pode alterar os seus atendimentos.");
    return atual;
  }

  /* Remarcação (arrastar no calendário): muda data, horário e, para o administrador, o barbeiro.
     Só atendimentos ainda em aberto (a confirmar ou confirmados) podem mudar de lugar. */
  async function remarcar(id, destino, usuario) {
    return db.transacao(async (tx) => {
      await travarDia(tx, destino.data);
      const atual = await carregarParaAlterar(tx, id, usuario);
      if (!["pendente", "confirmado"].includes(atual.status))
        throw new ErroNegocio(422, "Só dá para remarcar atendimentos a confirmar ou confirmados.", "status");

      const novoBarbeiroId =
        usuario.papel === "barbeiro" ? atual.barbeiro_id : idValido(destino.barbeiroId) || atual.barbeiro_id;
      const barbeiro = await barbeiroAtivo(novoBarbeiroId, tx);
      if (!barbeiro) throw new ErroNegocio(422, "Escolha um barbeiro válido.", "barbeiro");
      const { inicio, fim } = validarHorarioEquipe(destino.data, destino.hora, atual.fim_min - atual.inicio_min);
      if (!(await barbeiroLivre(tx, destino.data, barbeiro.id, inicio, fim, atual.id)))
        throw new ErroNegocio(409, `${barbeiro.nome} já tem atendimento nesse horário.`, "hora");

      await tx.query(
        `UPDATE agendamentos SET data = $1, inicio_min = $2, fim_min = $3, barbeiro_id = $4, atualizado_em = now()
          WHERE id = $5`,
        [destino.data, inicio, fim, barbeiro.id, atual.id]
      );
      return buscar(atual.id, tx);
    });
  }

  async function mudarStatus(id, novo, usuario) {
    return db.transacao(async (tx) => {
      const atual = await carregarParaAlterar(tx, id, usuario);
      if (!(TRANSICOES[atual.status] || []).includes(novo))
        throw new ErroNegocio(422, `Não é possível passar de "${atual.status}" para "${novo}".`, "status");

      await tx.query("UPDATE agendamentos SET status = $1, atualizado_em = now() WHERE id = $2", [novo, atual.id]);
      await tx.query("INSERT INTO historico_status (agendamento_id, de, para, usuario_id) VALUES ($1, $2, $3, $4)", [
        atual.id,
        atual.status,
        novo,
        usuario.id,
      ]);
      return buscar(atual.id, tx);
    });
  }

  /* LGPD (art. 15 e 16): passado o prazo de retenção, o cliente vira "Cliente anonimizado".
     O agendamento continua contando para as estatísticas, sem identificar ninguém. */
  async function anonimizarAntigos(dias = DIAS_RETENCAO) {
    const corte = regras.somarDias(regras.hojeISO(agora()), -dias);
    const linhas = await db.query(
      `UPDATE clientes c SET nome = 'Cliente anonimizado', telefone = NULL
        WHERE c.telefone IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.cliente_id = c.id AND a.data >= $1)
        RETURNING c.id`,
      [corte]
    );
    return linhas.length;
  }

  return {
    listarServicos,
    listarBarbeiros: () => listarBarbeiros(),
    disponibilidade,
    criarAgendamento,
    buscar: (id) => buscar(id),
    listar,
    resumo,
    resumoDe,
    relatorio,
    criarManual,
    remarcar,
    mudarStatus,
    anonimizarAntigos,
  };
}

module.exports = { criarAgenda, ErroNegocio, normalizarTelefone, formatarTelefone, TRANSICOES, DIAS_RETENCAO };
