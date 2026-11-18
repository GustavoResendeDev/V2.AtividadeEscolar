/* Configuração por variáveis de ambiente (veja .env.example). */
const path = require("node:path");

const producao = process.env.NODE_ENV === "production";

module.exports = {
  producao,
  porta: Number(process.env.PORT) || 3000,
  caminhoBanco: process.env.DB_PATH || path.join(__dirname, "..", "dados", "novaera.db"),
  pastaBackups: process.env.BACKUP_DIR || path.join(__dirname, "..", "backups"),
  admin: {
    nome: process.env.ADMIN_NOME || "Administrador",
    email: process.env.ADMIN_EMAIL || (producao ? null : "admin@novaera.com.br"),
    senha: process.env.ADMIN_SENHA || (producao ? null : "novaera2026"),
  },
};
