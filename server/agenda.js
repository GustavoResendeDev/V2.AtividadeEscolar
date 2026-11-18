/* Regras de negócio da agenda: horários livres, criação de agendamentos sem conflito,
   mudança de status e anonimização de dados antigos (LGPD). */
const crypto = require("node:crypto");
const regras = require("../public/js/regras.js");
const { transacao } = require("./db");

// Status que ocupam a cadeira do barbeiro. Cancelado libera o horário.
const STATUS_OCUPAM = ["pendente", "confirmado", "concluido", "faltou"];

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

const placeholders = (lista) => lista.map(() => "?").join(", ");

function criarAgenda(db, { agora = () => new Date() } = {}) {
  const servicoAtivo = (id) =>
    db.prepare("SELECT * FROM servicos WHERE id = ? AND ativo = 1").get(Number(id)) || null;
  const barbeiroAtivo = (id) =>
    db.prepare("SELECT * FROM barbeiros WHERE id = ? AND ativo = 1").get(Number(id)) || null;

  function listarServicos() {
    return db
      .prepare(
        "SELECT id, nome, categoria, duracao_min, preco_centavos FROM servicos WHERE ativo = 1 ORDER BY id"
      )
      .all();
  }

  function listarBarbeiros() {
    return db.prepare("SELECT id, nome, especialidade FROM barbeiros WHERE ativo = 1 ORDER BY id").all();
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

  function ocupacoes(data, barbeiroId) {
    return db
      .prepare(
        `SELECT inicio_min, fim_min FROM agendamentos
          WHERE data = ? AND barbeiro_id = ? AND status IN (${placeholders(STATUS_OCUPAM)})`
      )
      .all(data, barbeiroId, ...STATUS_OCUPAM);
  }

  const livre = (ocupados, inicio, fim) => !ocupados.some((o) => regras.sobrepoe(inicio, fim, o.inicio_min, o.fim_min));

  // Horário que já passou (hoje) não pode ser escolhido.
  function minutoMinimo(data) {
    const atual = regras.agoraEmBrasilia(agora());
    return data === regras.hojeISO(agora()) ? atual.minutos + 1 : 0;
  }

  /* Horários de início do serviço na data. Com barbeiro, olha só a agenda dele;
     sem barbeiro ("sem preferência"), o horário está livre se algum barbeiro estiver livre. */
  function disponibilidade({ data, servicoId, barbeiroId }) {
    validarData(data);
    const servico = servicoAtivo(servicoId);
    if (!servico) throw new ErroNegocio(422, "Escolha um serviço.", "servico");

    let barbeiros;
    if (barbeiroId) {
      const barbeiro = barbeiroAtivo(barbeiroId);
      if (!barbeiro) throw new ErroNegocio(422, "Escolha um barbeiro válido.", "barbeiro");
      barbeiros = [barbeiro];
    } else {
      barbeiros = listarBarbeiros();
    }

    const agendas = barbeiros.map((b) => ocupacoes(data, b.id));
    const minimo = minutoMinimo(data);
    return regras
      .gradeDeHorarios(servico.duracao_min)
      .filter((inicio) => inicio >= minimo)
      .map((inicio) => ({
        hora: regras.paraHora(inicio),
        disponivel: agendas.some((ocupados) => livre(ocupados, inicio, inicio + servico.duracao_min)),
      }));
  }

  function validarPedido(pedido) {
    const nome = String(pedido.nome || "").trim().replace(/\s+/g, " ");
    if (nome.length < 3) throw new ErroNegocio(422, "Informe seu nome (pelo menos 3 letras).", "nome");
    if (nome.length > 80) throw new ErroNegocio(422, "O nome pode ter no máximo 80 letras.", "nome");
    const telefone = normalizarTelefone(pedido.telefone);
    if (!telefone) throw new ErroNegocio(422, "Informe um WhatsApp válido, com DDD.", "telefone");
    if (pedido.consentimento !== true)
      throw new ErroNegocio(422, "Para agendar, aceite a Política de Privacidade.", "consentimento");

    const servico = servicoAtivo(pedido.servicoId);
    if (!servico) throw new ErroNegocio(422, "Escolha um serviço.", "servico");
    validarData(pedido.data);

    const inicio = regras.paraMinutos(pedido.hora);
    if (Number.isNaN(inicio)) throw new ErroNegocio(422, "Escolha um horário.", "hora");
    const fim = inicio + servico.duracao_min;
    const { abre, fecha, intervaloGrade } = regras.FUNCIONAMENTO;
    if (inicio < abre || fim > fecha || (inicio - abre) % intervaloGrade !== 0)
      throw new ErroNegocio(422, "Esse horário está fora do nosso funcionamento.", "hora");
    if (inicio < minutoMinimo(pedido.data))
      throw new ErroNegocio(422, "Esse horário já passou. Escolha outro.", "hora");

    let barbeiro = null;
    if (pedido.barbeiroId) {
      barbeiro = barbeiroAtivo(pedido.barbeiroId);
      if (!barbeiro) throw new ErroNegocio(422, "Escolha um barbeiro válido.", "barbeiro");
    }
    return { nome, telefone, servico, barbeiro, inicio, fim, data: pedido.data };
  }

  // Sem preferência: o barbeiro livre com menos atendimentos no dia (divide o trabalho).
  function escolherBarbeiro(data, inicio, fim) {
    const candidatos = listarBarbeiros()
      .map((b) => ({ ...b, ocupados: ocupacoes(data, b.id) }))
      .filter((b) => livre(b.ocupados, inicio, fim))
      .sort((a, b) => a.ocupados.length - b.ocupados.length || a.id - b.id);
    return candidatos[0] || null;
  }

  function criarAgendamento(pedido) {
    const p = validarPedido(pedido);

    // Transação exclusiva: dois clientes não conseguem pegar o mesmo horário ao mesmo tempo.
    return transacao(db, () => {
      let barbeiro = p.barbeiro;
      if (barbeiro) {
        if (!livre(ocupacoes(p.data, barbeiro.id), p.inicio, p.fim))
          throw new ErroNegocio(409, "Esse horário acabou de ser reservado. Escolha outro.", "hora");
      } else {
        barbeiro = escolherBarbeiro(p.data, p.inicio, p.fim);
        if (!barbeiro)
          throw new ErroNegocio(409, "Nenhum barbeiro está livre nesse horário. Escolha outro.", "hora");
      }

      const cliente = db
        .prepare(
          `INSERT INTO clientes (nome, telefone) VALUES (?, ?)
           ON CONFLICT (telefone) DO UPDATE SET nome = excluded.nome
           RETURNING id`
        )
        .get(p.nome, p.telefone);

      const codigo = crypto.randomBytes(4).toString("hex").toUpperCase();
      const { id } = db
        .prepare(
          `INSERT INTO agendamentos
             (codigo, cliente_id, servico_id, barbeiro_id, data, inicio_min, fim_min, preco_centavos, consentimento_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           RETURNING id`
        )
        .get(codigo, cliente.id, p.servico.id, barbeiro.id, p.data, p.inicio, p.fim, p.servico.preco_centavos);
      db.prepare("INSERT INTO historico_status (agendamento_id, de, para) VALUES (?, NULL, 'pendente')").run(id);
      return buscar(id);
    });
  }

  const SELECT_AGENDAMENTO = `
    SELECT a.id, a.codigo, a.data, a.inicio_min, a.fim_min, a.preco_centavos, a.status, a.criado_em,
           c.nome AS cliente_nome, c.telefone AS cliente_telefone,
           s.id AS servico_id, s.nome AS servico_nome,
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
      cliente: { nome: linha.cliente_nome, telefone: formatarTelefone(linha.cliente_telefone), whatsapp: linha.cliente_telefone ? `55${linha.cliente_telefone}` : null },
      servico: { id: linha.servico_id, nome: linha.servico_nome },
      barbeiro: { id: linha.barbeiro_id, nome: linha.barbeiro_nome },
      proximosStatus: TRANSICOES[linha.status],
    };
  }

  const buscar = (id) => formatar(db.prepare(`${SELECT_AGENDAMENTO} WHERE a.id = ?`).get(Number(id)));

  function listar({ data, barbeiroId, status }) {
    if (!regras.dataValida(data)) throw new ErroNegocio(422, "Data inválida.", "data");
    const filtros = ["a.data = ?"];
    const valores = [data];
    if (barbeiroId) {
      filtros.push("a.barbeiro_id = ?");
      valores.push(Number(barbeiroId));
    }
    if (status) {
      if (!TRANSICOES[status]) throw new ErroNegocio(422, "Status inválido.", "status");
      filtros.push("a.status = ?");
      valores.push(status);
    }
    return db
      .prepare(`${SELECT_AGENDAMENTO} WHERE ${filtros.join(" AND ")} ORDER BY a.inicio_min, b.nome`)
      .all(...valores)
      .map(formatar);
  }

  function resumo({ data, barbeiroId }) {
    const lista = listar({ data, barbeiroId });
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

  function mudarStatus(id, novo, usuario) {
    return transacao(db, () => {
      const atual = db.prepare("SELECT id, status, barbeiro_id FROM agendamentos WHERE id = ?").get(Number(id));
      if (!atual) throw new ErroNegocio(404, "Agendamento não encontrado.");
      if (usuario.papel === "barbeiro" && atual.barbeiro_id !== usuario.barbeiro_id)
        throw new ErroNegocio(403, "Você só pode alterar os seus atendimentos.");
      if (!(TRANSICOES[atual.status] || []).includes(novo))
        throw new ErroNegocio(422, `Não é possível passar de "${atual.status}" para "${novo}".`, "status");

      db.prepare("UPDATE agendamentos SET status = ?, atualizado_em = datetime('now') WHERE id = ?").run(novo, atual.id);
      db.prepare("INSERT INTO historico_status (agendamento_id, de, para, usuario_id) VALUES (?, ?, ?, ?)").run(
        atual.id,
        atual.status,
        novo,
        usuario.id
      );
      return buscar(atual.id);
    });
  }

  /* LGPD (art. 15 e 16): passado o prazo de retenção, o cliente vira "Cliente anonimizado".
     O agendamento continua contando para as estatísticas, sem identificar ninguém. */
  function anonimizarAntigos(dias = DIAS_RETENCAO) {
    const corte = regras.somarDias(regras.hojeISO(agora()), -dias);
    return transacao(db, () => {
      const antigos = db
        .prepare(
          `SELECT DISTINCT c.id FROM clientes c
            WHERE c.telefone IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM agendamentos a WHERE a.cliente_id = c.id AND a.data >= ?)`
        )
        .all(corte);
      const anonimizar = db.prepare("UPDATE clientes SET nome = 'Cliente anonimizado', telefone = NULL WHERE id = ?");
      antigos.forEach((c) => anonimizar.run(c.id));
      return antigos.length;
    });
  }

  return {
    listarServicos,
    listarBarbeiros,
    disponibilidade,
    criarAgendamento,
    buscar,
    listar,
    resumo,
    mudarStatus,
    anonimizarAntigos,
  };
}

module.exports = { criarAgenda, ErroNegocio, normalizarTelefone, formatarTelefone, TRANSICOES, DIAS_RETENCAO };
