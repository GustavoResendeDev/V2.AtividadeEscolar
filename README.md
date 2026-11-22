# Nova Era Barbearia — Sistema de Agendamento

Sistema web da Nova Era Barbearia (Goiânia – GO): site institucional, agendamento online com
banco de dados e painel para a equipe organizar a agenda (versão 2.2.0).

**No ar:** <https://nova-era-barbearia.novaera-barbearia.workers.dev> (Cloudflare + Supabase; veja [DEPLOY.md](DEPLOY.md)).

**Demonstração:** <https://gustavoresendedev.github.io/Nova-Era/>. Roda no navegador,
sem servidor, e os dados ficam só no aparelho de quem acessa. Para entrar no painel, use
`admin@novaera.com.br` e a senha `novaera2026`.

**Equipe:** Gustavo Rodrigues Resende (gerente de projeto), Belyt Vitoria (requisitos e documentação),
Felipe Santos de Santana Oliveira (arquitetura e back-end), Gabriel Fernandes Pinheiro (design e front-end)
e Gabriel Alberico Martins Oliveira (testes e treinamento).

| Tela | Endereço | Quem usa |
| --- | --- | --- |
| 1. Página inicial | `/` | Cliente |
| 2. Agendamento | `/agendamento` | Cliente |
| 3. Política de Privacidade (LGPD) | `/privacidade` | Cliente |
| 4. Login da equipe | `/admin/` | Barbeiro / administrador |
| 5. Painel da agenda | `/admin/painel` | Barbeiro / administrador |

Em produção os endereços não levam `.html`; no `npm start` e na demonstração, `/agendamento.html` etc. também funcionam.

Todas as telas são responsivas e testadas automaticamente em 9 tamanhos, do iPhone SE (320 px)
ao Full HD (1920 px), incluindo tablets em retrato e paisagem.

## Funcionalidades

**Cliente (site)**
- Agendamento com um ou mais serviços: a duração e o valor são somados e só aparecem horários em que tudo cabe.
- Escolha do barbeiro ou "sem preferência" (o sistema escolhe o barbeiro livre com menos atendimentos no dia).
- Ao final, um botão abre o WhatsApp da barbearia com o resumo do agendamento (sem emojis).

**Equipe (painel)**
- Agenda do dia, da semana ou do mês, em calendário (arrastar para remarcar) ou em lista.
- Confirmar, concluir, marcar falta ou cancelar. Ao confirmar, o painel oferece enviar ao cliente pelo
  WhatsApp a confirmação com data, horário, serviços, endereço e link do mapa.
- Agendamento manual (balcão, telefone, encaixe) com vários serviços.
- Apagar um atendimento ou todos os cancelados do período, para deixar a agenda limpa.
- Relatório de rendimento: cada barbeiro vê o seu; o administrador vê o estabelecimento completo ou um barbeiro.
- Aviso por e-mail (Resend) a cada agendamento feito pelo site.

**Equipe atual:** Marcio Rocha (barbeiro e administrador), Kaua e Felipe (barbeiros).

## Documentação do trabalho

> Os documentos em `docs/` foram entregues com a versão 2.1.0 e descrevem a arquitetura daquela época
> (Express, SQLite e Render). A arquitetura atual (Cloudflare Worker, Supabase, Resend e GitHub Actions)
> está descrita neste README e no [DEPLOY.md](DEPLOY.md).

| Entregável | Arquivo |
| --- | --- |
| Documentação do projeto e do sistema (ABNT, 7 fases) | `docs/Documentacao-Sistema-Nova-Era.docx` / `.pdf` |
| Manual do usuário e guia de treinamento | `docs/Manual-do-Usuario-Nova-Era.docx` / `.pdf` |
| Slides da apresentação (roteiro nas notas) | `docs/Apresentacao-Nova-Era.pptx` / `.pdf` |
| Diagramas do projeto e do sistema (PNG, SVG e fonte Mermaid) | `docs/diagramas/` |
| Capturas de tela (desktop, tablet e celular) | `docs/capturas/` |

## Tecnologias

- **Front-end:** HTML5, CSS3 e JavaScript puro (sem framework), fontes hospedadas no próprio site.
- **Back-end:** API REST com [Hono](https://hono.dev), rodando num Cloudflare Worker ao lado do banco, com Hyperdrive.
- **Banco de dados:** PostgreSQL na Supabase (produção) e PGlite, um Postgres em WebAssembly (no seu computador e nos testes).
- **E-mail:** aviso de novo agendamento para a barbearia pelo Resend.
- **Testes:** `node:test` (unitários e de API) + Playwright (ponta a ponta e responsividade).
- **Implantação:** tudo no plano grátis, sem servidor próprio. Deploy e backup noturno (para o Cloudflare R2) pelo GitHub Actions. Passo a passo em [DEPLOY.md](DEPLOY.md).

## Como rodar no seu computador

Pré-requisito: [Node.js 22.12 ou mais novo](https://nodejs.org/). Não precisa de conta nem de banco instalado.

```bash
npm install
```

```bash
npm start
```

Abra <http://localhost:3000>. Na primeira execução o banco é criado em `dados/pglite/`, já com
os serviços e barbeiros da casa, e são criados logins de demonstração (senha `novaera2026`):

| Login | Papel |
| --- | --- |
| `admin@novaera.com.br` | Administrador (vê todos os barbeiros) |
| `marcio@novaera.com.br`, `kaua@novaera.com.br`, `felipe@novaera.com.br` | Barbeiro (vê só a própria agenda) |

> Os logins de demonstração só existem no seu computador. Em produção, o administrador é criado
> no primeiro deploy pelos segredos `ADMIN_EMAIL` e `ADMIN_SENHA` (veja [DEPLOY.md](DEPLOY.md)).

## Testes

```bash
npm test
```

Para os testes no navegador (fluxo completo e responsividade), instale o Playwright uma vez:

```bash
npm i --no-save playwright@1.63.0 && npx playwright install chromium
```

```bash
npm run test:e2e
```

Para testar o site exatamente como ele é publicado (minificado e versionado), monte e teste o `dist/`:

```bash
npm run build && SITE_DIR=dist npm run test:e2e
```

## Estrutura

```
public/            telas (HTML, CSS, JS, imagens, fontes)
  js/regras.js     regras de funcionamento, usadas pelo navegador E pelo servidor
  admin/           login e painel da equipe
  _headers         cabeçalhos de segurança das páginas na Cloudflare
server/
  worker.mjs       entrada do Cloudflare Worker (API + manutenção diária pelo cron)
  app.js           rotas da API e segurança (CSP, cabeçalhos, erros)
  agenda.js        regras de negócio: horários livres, conflitos, status, LGPD
  auth.js          senhas (bcrypt no banco), sessões e limite de tentativas
  email.js         aviso de novo agendamento pelo Resend
  catalogo.js      serviços e barbeiros em memória por 60 s (menos idas ao banco)
  banco.js         conexão com a Supabase (postgres.js, pelo Hyperdrive)
  banco-local.js   PGlite para o npm start e os testes
  index.js, local.js  servidor local (npm start)
db/schema.sql      tabelas, segurança (RLS) e dados iniciais; o deploy aplica sozinho
scripts/           aplicar o schema (migrar.js) e criar usuário (criar-usuario.js)
scripts/montar-site.mjs  monta dist/ (site publicado): minifica e versiona CSS/JS, links sem .html
pages/             versão de demonstração para o GitHub Pages (API simulada no navegador)
wrangler.toml      configuração do Worker (Hyperdrive, API rodando ao lado do banco)
tests/             unit/, api/ e e2e/
docs/              documentação do projeto, manual, slides e diagramas
```

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/servicos` | Serviços ativos (nome, duração, preço); o navegador guarda por 5 min |
| GET | `/api/barbeiros` | Barbeiros ativos; o navegador guarda por 5 min |
| GET | `/api/disponibilidade?data=&servicos=1,7&barbeiro=` | Horários livres do dia para a duração somada |
| POST | `/api/agendamentos` | Cria um agendamento (devolve código e link do WhatsApp) |
| POST | `/api/admin/login` · `/api/admin/logout` | Entrar e sair do painel |
| GET | `/api/sessao` | Usuário logado ou `null` (usado pela tela de login) |
| GET | `/api/admin/me` | Usuário logado (exige login) |
| GET | `/api/admin/agendamentos?data=` ou `?inicio=&fim=` (+ `barbeiro`, `status`) | Agenda de um dia ou período + indicadores |
| POST | `/api/admin/agendamentos` | Agendamento manual da equipe (já confirmado) |
| PATCH | `/api/admin/agendamentos/:id` | Muda a situação (confirmar, concluir, faltou, cancelar) |
| PATCH | `/api/admin/agendamentos/:id/horario` | Remarca data, horário ou barbeiro |
| DELETE | `/api/admin/agendamentos/:id` | Apaga um atendimento (barbeiro: só os próprios) |
| DELETE | `/api/admin/agendamentos?inicio=&fim=` | Apaga os cancelados do período (+ `barbeiro`) |
| GET | `/api/admin/relatorio?inicio=&fim=` (+ `barbeiro`) | Relatório de rendimento; barbeiro recebe só o próprio |
| GET | `/api/saude` | Verificação de funcionamento (usada pela hospedagem) |

## Implantação (produção)

Cloudflare Worker (site + API) + Supabase (banco) + Resend (e-mail), com deploy e backup noturno
no GitHub Actions. Tudo no plano grátis. Passo a passo e lista de segredos em [DEPLOY.md](DEPLOY.md).

## Manutenção

- **Novo usuário:** com `DATABASE_URL` no `.env`, `npm run usuario -- --nome "Ana" --email ana@novaera.com.br --senha "senhaForte123" --papel barbeiro --barbeiro 2`
  (ids dos barbeiros: 1 Marcio Rocha, 2 Kaua, 3 Felipe).
- **Serviços e equipe:** mudanças no catálogo entram em `db/schema.sql` (seção de ajustes), que o deploy aplica.
- **Apagar:** pelo painel; o cliente que fica sem nenhum agendamento também sai do banco.
- **Backup:** todo dia às 02:30 (Brasília) o GitHub Actions salva o banco no Cloudflare R2 e guarda 30 dias. Para restaurar, veja [DEPLOY.md](DEPLOY.md).
- **LGPD:** todo dia o sistema anonimiza nome e telefone de clientes sem atendimento há mais de 180 dias.
- **Feriados e horário:** edite `FUNCIONAMENTO` em `public/js/regras.js` (vale para o site e o servidor).
