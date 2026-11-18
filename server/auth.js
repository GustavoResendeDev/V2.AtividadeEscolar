/* Autenticação do painel: senhas com scrypt e sessões guardadas no banco.
   O navegador recebe só um token aleatório (cookie HttpOnly); o banco guarda o hash dele. */
const crypto = require("node:crypto");

const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000; // um turno de trabalho
const COOKIE = "sessao";

function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString("hex")}$${hash.toString("hex")}`;
}

function conferirSenha(senha, armazenado) {
  const [algoritmo, salHex, hashHex] = String(armazenado).split("$");
  if (algoritmo !== "scrypt" || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, "hex");
  const calculado = crypto.scryptSync(String(senha), Buffer.from(salHex, "hex"), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

// Hash usado quando o e-mail não existe, para o tempo de resposta não denunciar isso.
const HASH_FALSO = gerarHashSenha(crypto.randomBytes(12).toString("hex"));

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

function lerCookie(req, nome) {
  const cabecalho = req.headers.cookie || "";
  for (const parte of cabecalho.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}

function criarAuth(db, { producao = false, agora = () => Date.now() } = {}) {
  const atributosCookie = ["Path=/", "HttpOnly", "SameSite=Strict", producao ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");

  function entrar(res, email, senha) {
    const usuario = db
      .prepare("SELECT id, nome, email, papel, barbeiro_id, senha_hash FROM usuarios WHERE email = ? AND ativo = 1")
      .get(String(email || "").trim());
    const ok = conferirSenha(senha || "", usuario ? usuario.senha_hash : HASH_FALSO);
    if (!usuario || !ok) return null;

    db.prepare("DELETE FROM sessoes WHERE expira_em < ?").run(agora());
    const token = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)").run(
      hashToken(token),
      usuario.id,
      agora() + DURACAO_SESSAO_MS
    );
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${token}; ${atributosCookie}; Max-Age=${DURACAO_SESSAO_MS / 1000}`
    );
    delete usuario.senha_hash;
    return usuario;
  }

  function sair(req, res) {
    const token = lerCookie(req, COOKIE);
    if (token) db.prepare("DELETE FROM sessoes WHERE token_hash = ?").run(hashToken(token));
    res.setHeader("Set-Cookie", `${COOKIE}=; ${atributosCookie}; Max-Age=0`);
  }

  function usuarioDaSessao(req) {
    const token = lerCookie(req, COOKIE);
    if (!token) return null;
    return (
      db
        .prepare(
          `SELECT u.id, u.nome, u.email, u.papel, u.barbeiro_id
             FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1`
        )
        .get(hashToken(token), agora()) || null
    );
  }

  // Middleware: só deixa passar quem está logado.
  function exigirLogin(req, res, next) {
    const usuario = usuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ erro: "Faça login para continuar." });
    req.usuario = usuario;
    next();
  }

  return { entrar, sair, exigirLogin, usuarioDaSessao };
}

/* Limita tentativas de login por IP (proteção contra força bruta).
   Guardado em memória: suficiente para um único servidor. */
function criarLimitador({ maximo = 5, janelaMs = 15 * 60 * 1000, agora = () => Date.now() } = {}) {
  const tentativas = new Map();

  function bloqueado(chave) {
    const registro = tentativas.get(chave);
    if (!registro) return 0;
    if (agora() - registro.inicio > janelaMs) {
      tentativas.delete(chave);
      return 0;
    }
    return registro.falhas >= maximo ? Math.ceil((registro.inicio + janelaMs - agora()) / 1000) : 0;
  }

  function falhou(chave) {
    const registro = tentativas.get(chave);
    if (!registro || agora() - registro.inicio > janelaMs) tentativas.set(chave, { inicio: agora(), falhas: 1 });
    else registro.falhas += 1;
  }

  const limpar = (chave) => tentativas.delete(chave);

  return { bloqueado, falhou, limpar };
}

module.exports = { gerarHashSenha, conferirSenha, criarAuth, criarLimitador };
