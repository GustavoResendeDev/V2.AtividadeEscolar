/* Banco de dados SQLite (módulo nativo node:sqlite, sem dependências externas).
   Cria as tabelas na primeira execução e cadastra os serviços e barbeiros da casa. */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS barbeiros (
  id             INTEGER PRIMARY KEY,
  nome           TEXT    NOT NULL UNIQUE,
  especialidade  TEXT    NOT NULL,
  ativo          INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

CREATE TABLE IF NOT EXISTS servicos (
  id              INTEGER PRIMARY KEY,
  nome            TEXT    NOT NULL UNIQUE,
  categoria       TEXT    NOT NULL,
  duracao_min     INTEGER NOT NULL CHECK (duracao_min > 0),
  preco_centavos  INTEGER NOT NULL CHECK (preco_centavos >= 0),
  ativo           INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

CREATE TABLE IF NOT EXISTS clientes (
  id         INTEGER PRIMARY KEY,
  nome       TEXT    NOT NULL,
  telefone   TEXT    UNIQUE,
  criado_em  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id               INTEGER PRIMARY KEY,
  codigo           TEXT    NOT NULL UNIQUE,
  cliente_id       INTEGER NOT NULL REFERENCES clientes(id),
  servico_id       INTEGER NOT NULL REFERENCES servicos(id),
  barbeiro_id      INTEGER NOT NULL REFERENCES barbeiros(id),
  data             TEXT    NOT NULL,
  inicio_min       INTEGER NOT NULL,
  fim_min          INTEGER NOT NULL,
  preco_centavos   INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'confirmado', 'concluido', 'cancelado', 'faltou')),
  consentimento_em TEXT    NOT NULL,
  criado_em        TEXT    NOT NULL DEFAULT (datetime('now')),
  atualizado_em    TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (fim_min > inicio_min)
);
CREATE INDEX IF NOT EXISTS idx_agendamentos_agenda ON agendamentos (data, barbeiro_id, status);

-- Serviços de cada agendamento (o cliente pode escolher mais de um).
-- agendamentos.servico_id continua guardando o primeiro, por compatibilidade.
CREATE TABLE IF NOT EXISTS agendamento_servicos (
  agendamento_id  INTEGER NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
  servico_id      INTEGER NOT NULL REFERENCES servicos(id),
  ordem           INTEGER NOT NULL,
  duracao_min     INTEGER NOT NULL,
  preco_centavos  INTEGER NOT NULL,
  PRIMARY KEY (agendamento_id, servico_id)
);

CREATE TABLE IF NOT EXISTS usuarios (
  id           INTEGER PRIMARY KEY,
  nome         TEXT    NOT NULL,
  email        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash   TEXT    NOT NULL,
  papel        TEXT    NOT NULL CHECK (papel IN ('admin', 'barbeiro')),
  barbeiro_id  INTEGER REFERENCES barbeiros(id),
  ativo        INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash  TEXT    PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS historico_status (
  id              INTEGER PRIMARY KEY,
  agendamento_id  INTEGER NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
  de              TEXT,
  para            TEXT    NOT NULL,
  usuario_id      INTEGER REFERENCES usuarios(id),
  em              TEXT    NOT NULL DEFAULT (datetime('now'))
);
`;

const BARBEIROS = [
  ["Rafael Moura", "Cortes clássicos e navalha"],
  ["Thiago Brandão", "Degradê e freestyle"],
  ["Caio Henrique", "Barba e bigode"],
];

// [nome, categoria, duração em minutos, preço em centavos] — igual ao menu da página inicial.
const SERVICOS = [
  ["Corte Masculino", "Cabelo", 60, 4000],
  ["Corte e Barba", "Cabelo", 60, 7500],
  ["Camuflagem de Cabelos Brancos", "Cabelo", 140, 12000],
  ["Coloração / Tonalização", "Cabelo", 120, 12000],
  ["Hidratação", "Cabelo", 30, 3000],
  ["Higienização + Secagem", "Cabelo", 20, 2000],
  ["Barba Tradicional / Modelada", "Barba e Bigode", 30, 3500],
  ["Barba com Máquina", "Barba e Bigode", 30, 3500],
  ["Bigode Modelado", "Barba e Bigode", 30, 3500],
];

function abrirBanco(caminho = ":memory:") {
  if (caminho !== ":memory:") fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA foreign_keys = ON;");
  if (caminho !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  popular(db);
  return db;
}

function popular(db) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM barbeiros").get();
  if (n > 0) return;
  transacao(db, () => {
    const insBarbeiro = db.prepare("INSERT INTO barbeiros (nome, especialidade) VALUES (?, ?)");
    BARBEIROS.forEach((b) => insBarbeiro.run(...b));
    const insServico = db.prepare(
      "INSERT INTO servicos (nome, categoria, duracao_min, preco_centavos) VALUES (?, ?, ?, ?)"
    );
    SERVICOS.forEach((s) => insServico.run(...s));
  });
}

// Executa `fn` numa transação exclusiva: ou tudo é gravado, ou nada.
function transacao(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultado = fn();
    db.exec("COMMIT");
    return resultado;
  } catch (erro) {
    db.exec("ROLLBACK");
    throw erro;
  }
}

module.exports = { abrirBanco, transacao };
