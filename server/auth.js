/* Autenticação do painel.
   Senhas: bcrypt calculado DENTRO do Postgres (pgcrypto). Assim o Worker não gasta CPU com hash
   (o plano grátis da Cloudflare dá só 10 ms de CPU por requisição).
   Sessões: o navegador recebe só um token aleatório (cookie HttpOnly); o banco guarda o hash dele. */

const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000; // um turno de trabalho
const COOKIE = "sessao";
const CUSTO_BCRYPT = 10;

// Hash bcrypt qualquer, usado quando o e-mail não existe, para o tempo de resposta não denunciar isso.
const HASH_FALSO = "$2a$10$m1dfJlYTRGQb4e9.vRLsIuiF0.chSz/xM3gtgepBz7nzjUt1TDio.";

const paraHex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

async function hashToken(token) {
  return paraHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

function novoToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function lerCookie(cabecalho, nome) {
  for (const parte of String(cabecalho || "").split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}

/* Cadastro de usuário (script npm run usuario, deploy e testes). Atualiza se o e-mail já existir. */
async function criarUsuario(db, { nome, email, senha, papel = "admin", barbeiroId = null }) {
  if (!nome || !email || !senha) throw new Error("Informe nome, e-mail e senha.");
  if (String(senha).length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (!["admin", "barbeiro"].includes(papel)) throw new Error("Papel deve ser admin ou barbeiro.");
  if (papel === "barbeiro" && !barbeiroId) throw new Error("Usuário barbeiro precisa do id do barbeiro.");
  return db.um(
    `INSERT INTO usuarios (nome, email, senha_hash, papel, barbeiro_id)
     VALUES ($1, $2, crypt($3, gen_salt('bf', ${CUSTO_BCRYPT})), $4, $5)
     ON CONFLICT (lower(email)) DO UPDATE SET nome = excluded.nome, senha_hash = excluded.senha_hash,
       papel = excluded.papel, barbeiro_id = excluded.barbeiro_id, ativo = TRUE
     RETURNING id, nome, email, papel, barbeiro_id`,
    [nome, String(email).trim(), String(senha), papel, barbeiroId]
  );
}

function criarAuth(db, { producao = false, agora = () => Date.now() } = {}) {
  const atributosCookie = ["Path=/", "HttpOnly", "SameSite=Strict", producao ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");

  /* Confere e-mail e senha numa consulta só. Devolve { usuario, cookie } ou null. */
  async function entrar(email, senha) {
    const linha = await db.um(
      `SELECT u.id, u.nome, u.email, u.papel, u.barbeiro_id,
              (u.id IS NOT NULL AND crypt($2, COALESCE(u.senha_hash, $3)) = COALESCE(u.senha_hash, $3)) AS ok
         FROM (SELECT 1) AS x
         LEFT JOIN usuarios u ON lower(u.email) = lower($1) AND u.ativo`,
      [String(email || "").trim(), String(senha || ""), HASH_FALSO]
    );
    if (!linha || !linha.ok) return null;

    const token = novoToken();
    await db.query("DELETE FROM sessoes WHERE expira_em < $1", [agora()]);
    await db.query("INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES ($1, $2, $3)", [
      await hashToken(token),
      linha.id,
      agora() + DURACAO_SESSAO_MS,
    ]);
    const { ok, ...usuario } = linha;
    return { usuario, cookie: `${COOKIE}=${token}; ${atributosCookie}; Max-Age=${DURACAO_SESSAO_MS / 1000}` };
  }

  /* Apaga a sessão e devolve o cookie que a remove do navegador. */
  async function sair(cabecalhoCookie) {
    const token = lerCookie(cabecalhoCookie, COOKIE);
    if (token) await db.query("DELETE FROM sessoes WHERE token_hash = $1", [await hashToken(token)]);
    return `${COOKIE}=; ${atributosCookie}; Max-Age=0`;
  }

  async function usuarioDaSessao(cabecalhoCookie) {
    const token = lerCookie(cabecalhoCookie, COOKIE);
    if (!token) return null;
    return db.um(
      `SELECT u.id, u.nome, u.email, u.papel, u.barbeiro_id
         FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = $1 AND s.expira_em > $2 AND u.ativo`,
      [await hashToken(token), agora()]
    );
  }

  return { entrar, sair, usuarioDaSessao };
}

/* Limita tentativas de login por IP (proteção contra força bruta).
   Fica no banco porque o Worker roda em muitas máquinas ao mesmo tempo. */
function criarLimitador(db, { maximo = 5, janelaMs = 15 * 60 * 1000, agora = () => Date.now() } = {}) {
  async function bloqueado(chave) {
    const registro = await db.um("SELECT inicio, falhas FROM tentativas_login WHERE chave = $1", [chave]);
    if (!registro) return 0;
    const inicio = Number(registro.inicio);
    if (agora() - inicio > janelaMs) return 0;
    return registro.falhas >= maximo ? Math.ceil((inicio + janelaMs - agora()) / 1000) : 0;
  }

  async function falhou(chave) {
    await db.query(
      `INSERT INTO tentativas_login (chave, inicio, falhas) VALUES ($1, $2, 1)
       ON CONFLICT (chave) DO UPDATE SET
         falhas = CASE WHEN $2 - tentativas_login.inicio > $3 THEN 1 ELSE tentativas_login.falhas + 1 END,
         inicio = CASE WHEN $2 - tentativas_login.inicio > $3 THEN $2 ELSE tentativas_login.inicio END`,
      [chave, agora(), janelaMs]
    );
  }

  const limpar = (chave) => db.query("DELETE FROM tentativas_login WHERE chave = $1", [chave]);

  return { bloqueado, falhou, limpar };
}

/* Limpeza diária (cron): sessões vencidas e contadores de tentativas antigos. */
async function limparExpirados(db, { agora = () => Date.now() } = {}) {
  await db.query("DELETE FROM sessoes WHERE expira_em < $1", [agora()]);
  await db.query("DELETE FROM tentativas_login WHERE inicio < $1", [agora() - 24 * 60 * 60 * 1000]);
}

module.exports = { criarUsuario, criarAuth, criarLimitador, limparExpirados, lerCookie };
