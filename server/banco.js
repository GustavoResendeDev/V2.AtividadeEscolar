/* Acesso ao PostgreSQL com uma interface mínima, igual em todos os ambientes:
     db.query(sql, params)  -> linhas (array)
     db.um(sql, params)     -> primeira linha ou null
     db.transacao(fn)       -> executa fn(tx) numa transação; tx também tem query e um
   Produção (Cloudflare Worker): postgres.js falando com a Supabase (este arquivo).
   Testes e npm start: PGlite, Postgres em WebAssembly (server/banco-local.js). */

function interfaceDe(executar) {
  return {
    query: (sql, params = []) => executar(sql, params),
    um: async (sql, params = []) => (await executar(sql, params))[0] || null,
  };
}

/* `prepare: false` é exigido pelo pooler da Supabase em modo transação (porta 6543). */
function bancoPostgres(urlConexao) {
  const modulo = require("postgres");
  const postgres = modulo.default || modulo; // no Worker vem como módulo ESM
  const sql = postgres(urlConexao, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
  const db = interfaceDe((texto, params) => sql.unsafe(texto, params));
  db.transacao = (fn) => sql.begin((t) => fn(interfaceDe((texto, params) => t.unsafe(texto, params))));
  db.executarScript = (texto) => sql.unsafe(texto);
  db.fechar = () => sql.end({ timeout: 5 });
  return db;
}

module.exports = { interfaceDe, bancoPostgres };
