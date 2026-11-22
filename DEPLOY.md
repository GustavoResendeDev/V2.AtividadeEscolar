# Implantação: Cloudflare + Supabase + Resend + GitHub Actions

Tudo no plano grátis, sem VPS.

| Peça | Serviço | O que faz |
| --- | --- | --- |
| Site e API | Cloudflare Worker `nova-era-barbearia` | Entrega as páginas (montadas de `public/` em `dist/`) e responde `/api/*`. Cron diário às 03:00 (anonimização LGPD). |
| Conexão com o banco | Cloudflare Hyperdrive `novaera-banco` | Mantém conexões abertas com a Supabase e as reaproveita entre requisições (cache de consultas desligado). |
| Banco | Supabase, projeto **Nova Era Barbearia** | PostgreSQL. Tabelas com RLS ligado: a chave pública da Supabase não lê nada. |
| E-mail | Resend | Avisa a barbearia de cada agendamento feito pelo site. |
| Deploy | GitHub Actions `deploy.yml` | A cada push na `main`: testes, schema do banco e publicação do Worker. |
| Backup | GitHub Actions `backup.yml` + Cloudflare R2 | Todo dia às 02:30, `pg_dump` do banco para o bucket `novaera-backups` (guarda 30 dias). |

## Configuração inicial (uma vez)

### 1. Supabase

No projeto **Nova Era Barbearia**, clique em **Connect** e copie duas strings de conexão:

- **Transaction pooler** (porta **6543**): vai para o segredo `DATABASE_URL` (usado pelo Worker).
- **Session pooler** (porta **5432**): vai para o segredo `SUPABASE_DB_URL` (usado pelo deploy e pelo backup).

Troque `[YOUR-PASSWORD]` pela senha do banco. Se não souber a senha, redefina em
**Project Settings › Database › Reset database password**.

### 2. Cloudflare

1. **R2:** ative o R2 no painel (pede um cartão cadastrado, mas os primeiros 10 GB são grátis) e crie o bucket:
   ```bash
   npx wrangler r2 bucket create novaera-backups
   npx wrangler r2 bucket lifecycle add novaera-backups expirar-30-dias diario/ --expire-days 30
   ```
2. **Token para o GitHub:** **My Profile › API Tokens › Create Token** › modelo **Edit Cloudflare Workers**,
   e acrescente a permissão **Account › Workers R2 Storage › Edit**. Copie o token.
3. **Account ID:** aparece em `npx wrangler whoami` ou na lateral da página inicial da conta.

### 3. Resend

**API Keys › Create API Key** (permissão *Sending access*). Sem domínio próprio verificado, o Resend só
entrega para o e-mail da sua conta no Resend: use esse e-mail em `EMAIL_AVISO_PARA`. Com domínio
verificado, dá para mandar para qualquer endereço e definir o remetente (variável `EMAIL_REMETENTE`
no `wrangler.toml`, ex.: `Nova Era <avisos@seudominio.com.br>`).

### 4. Segredos no GitHub

Em **Settings › Secrets and variables › Actions**:

| Segredo | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | token do passo 2.2 |
| `CLOUDFLARE_ACCOUNT_ID` | id do passo 2.3 |
| `DATABASE_URL` | string do *Transaction pooler* (6543) |
| `SUPABASE_DB_URL` | string do *Session pooler* (5432) |
| `ADMIN_EMAIL` / `ADMIN_SENHA` | login do administrador, criado no primeiro deploy (senha com 8+ caracteres) |
| `RESEND_API_KEY` | chave do Resend |
| `EMAIL_AVISO_PARA` | quem recebe os avisos (vários: separados por vírgula) |

Variável (aba **Variables**), opcional: `URL_SITE` = endereço do Worker (ex.: `https://nova-era-barbearia.SEU-SUBDOMINIO.workers.dev`),
para o deploy conferir se a API respondeu.

Ou pelo terminal, com o `gh`: `gh secret set DATABASE_URL` (ele pede o valor sem mostrar na tela).

### 5. Primeiro deploy

Faça merge na `main` (ou rode **Actions › Deploy na Cloudflare › Run workflow**). O endereço final
aparece no log do passo *Publica o Worker*. Para usar um domínio próprio: **Workers › nova-era-barbearia ›
Settings › Domains & Routes**.

## No dia a dia

- **Publicar:** push na `main`.
- **Novo usuário do painel:** coloque `DATABASE_URL` (session pooler) no `.env` e rode
  `npm run usuario -- --nome "Ana" --email ana@novaera.com.br --senha "senhaForte123" --papel barbeiro --barbeiro 2`.
- **Ver erros do Worker:** `npx wrangler tail` ou o painel do Worker › Logs.
- **Backup na hora:** **Actions › Backup noturno › Run workflow**.

## Restaurar um backup

```bash
npx wrangler r2 object get novaera-backups/diario/NOME-DO-ARQUIVO.dump --file=backup.dump --remote
pg_restore --clean --if-exists --no-owner --no-privileges --schema=public -d "$SUPABASE_DB_URL" backup.dump
```

Teste antes num projeto Supabase separado sempre que possível: `--clean` apaga as tabelas atuais antes de recriar.

## Desempenho

- **API ao lado do banco:** `[placement]` no `wrangler.toml` roda a API em Oregon (aws us-west-2), onde está
  a Supabase. Cada consulta leva poucos milissegundos; só a ida e volta do visitante até lá é longa.
- **Hyperdrive:** conexões já abertas, sem o aperto de mão de TCP, TLS e senha a cada requisição.
- **Catálogo em memória:** serviços e barbeiros ficam 60 s no Worker e 5 min no navegador.
- **Site montado** (`npm run build`, que o `wrangler deploy` roda sozinho): CSS e JS minificados e com
  `?v=<impressão digital>`, guardados por 1 ano no navegador; links internos sem `.html` (sem redirecionamento).
- **Página inicial:** imagens de fundo e a capa do vídeo só depois do carregamento; o vídeo só perto da seção.

**Trocou a senha do banco?** Atualize também o Hyperdrive:
`npx wrangler hyperdrive update c6f4b18e379f44c6929a6081ba3ac76c --connection-string="<session pooler, porta 5432>"`.

## Limites do plano grátis (folgados para uma barbearia)

- **Worker:** 100 mil requisições de API por dia; páginas e imagens não contam. **Hyperdrive:** 100 mil consultas por dia. 10 ms de CPU por
  requisição, por isso a senha é conferida dentro do Postgres (bcrypt do `pgcrypto`).
- **Supabase:** 500 MB de banco. O projeto pausa após 7 dias sem uso; o backup diário já conta como uso.
- **Resend:** 3 mil e-mails por mês, 100 por dia.
- **R2:** 10 GB. Cada backup tem poucos KB.
