/* Banco local com PGlite (Postgres em WebAssembly): testes (em memória) e npm start (pasta dados/).
   Só roda no Node; o Worker usa server/banco.js. */
const fs = require("node:fs");
const path = require("node:path");
const { interfaceDe } = require("./banco");

const lerSchema = () => fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");

async function bancoLocal(pasta = null) {
  const { PGlite } = require("@electric-sql/pglite");
  const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
  if (pasta) fs.mkdirSync(pasta, { recursive: true });
  const pg = await PGlite.create(pasta || undefined, { extensions: { pgcrypto } });
  const rodar = (alvo) => async (texto, params) => (await alvo.query(texto, params)).rows;
  const db = interfaceDe(rodar(pg));
  db.transacao = (fn) => pg.transaction((tx) => fn(interfaceDe(rodar(tx))));
  db.executarScript = (texto) => pg.exec(texto);
  db.fechar = () => pg.close();
  await db.executarScript(lerSchema());
  return db;
}

module.exports = { bancoLocal, lerSchema };
