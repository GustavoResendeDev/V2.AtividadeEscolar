/* Cópia de segurança consistente do banco (VACUUM INTO), mesmo com o servidor rodando.
   Mantém os 30 backups mais recentes. Uso: npm run backup */
const fs = require("node:fs");
const path = require("node:path");
const config = require("../server/config");
const { abrirBanco } = require("../server/db");

const MANTER = 30;
fs.mkdirSync(config.pastaBackups, { recursive: true });
const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const destino = path.join(config.pastaBackups, `novaera-${carimbo}.db`);

const db = abrirBanco(config.caminhoBanco);
db.prepare("VACUUM INTO ?").run(destino);
db.close();
console.info(`Backup criado: ${destino}`);

const antigos = fs
  .readdirSync(config.pastaBackups)
  .filter((f) => /^novaera-.*\.db$/.test(f))
  .sort()
  .reverse()
  .slice(MANTER);
antigos.forEach((f) => fs.unlinkSync(path.join(config.pastaBackups, f)));
if (antigos.length) console.info(`${antigos.length} backup(s) antigo(s) removido(s).`);
