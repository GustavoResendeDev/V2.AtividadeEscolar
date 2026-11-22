# Nova Era Barbearia — Sistema de Agendamento

Sistema web da Nova Era Barbearia (Goiânia – GO): site institucional, agendamento online com
banco de dados e painel para a equipe organizar a agenda (versão 2.1.0).

**Demonstração:** <https://gustavoresendedev.github.io/V2.AtividadeEscolar/>. Roda no navegador,
sem servidor, e os dados ficam só no aparelho de quem acessa. Para entrar no painel, use
`admin@novaera.com.br` e a senha `novaera2026`.

**Equipe:** Gustavo Rodrigues Resende (gerente de projeto), Belyt Vitoria (requisitos e documentação),
Felipe Santos de Santana Oliveira (arquitetura e back-end), Gabriel Fernandes Pinheiro (design e front-end)
e Gabriel Alberico Martins Oliveira (testes e treinamento).

| Tela | Endereço | Quem usa |
| --- | --- | --- |
| 1. Página inicial | `/` | Cliente |
| 2. Agendamento | `/agendamento.html` | Cliente |
| 3. Política de Privacidade (LGPD) | `/privacidade.html` | Cliente |
| 4. Login da equipe | `/admin/` | Barbeiro / administrador |
| 5. Painel da agenda | `/admin/painel.html` | Barbeiro / administrador |

Todas as telas são responsivas e testadas automaticamente em 9 tamanhos, do iPhone SE (320 px)
ao Full HD (1920 px), incluindo tablets em retrato e paisagem.

## Documentação do trabalho

| Entregável | Arquivo |
| --- | --- |
| Documentação do projeto e do sistema (ABNT, 7 fases) | `docs/Documentacao-Sistema-Nova-Era.docx` / `.pdf` |
| Manual do usuário e guia de treinamento | `docs/Manual-do-Usuario-Nova-Era.docx` / `.pdf` |
| Slides da apresentação (roteiro nas notas) | `docs/Apresentacao-Nova-Era.pptx` / `.pdf` |
| Diagramas do projeto e do sistema (PNG, SVG e fonte Mermaid) | `docs/diagramas/` |
| Capturas de tela (desktop, tablet e celular) | `docs/capturas/` |

## Tecnologias

- **Front-end:** HTML5, CSS3 e JavaScript puro (sem framework), fontes hospedadas no próprio site.
- **Back-end:** API REST com [Hono](https://hono.dev), rodando num Cloudflare Worker.
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
| `rafael@novaera.com.br`, `thiago@novaera.com.br`, `caio@novaera.com.br` | Barbeiro (vê só a própria agenda) |

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
  banco.js         conexão com a Supabase (postgres.js)
  banco-local.js   PGlite para o npm start e os testes
  index.js, local.js  servidor local (npm start)
db/schema.sql      tabelas, segurança (RLS) e dados iniciais; o deploy aplica sozinho
scripts/           aplicar o schema e criar usuário
wrangler.toml      configuração do Worker
tests/             unit/, api/ e e2e/
docs/              documentação do projeto, manual, slides e diagramas
```

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/servicos` | Serviços ativos (nome, duração, preço) |
| GET | `/api/barbeiros` | Barbeiros ativos |
| GET | `/api/disponibilidade?data=&servicos=1,7&barbeiro=` | Horários livres do dia para a duração somada |
| POST | `/api/agendamentos` | Cria um agendamento (devolve código e link do WhatsApp) |
| POST | `/api/admin/login` · `/api/admin/logout` | Entrar e sair do painel |
| GET | `/api/admin/agendamentos?data=` ou `?inicio=&fim=` (+ `barbeiro`, `status`) | Agenda de um dia ou período + indicadores |
| POST | `/api/admin/agendamentos` | Agendamento manual da equipe (já confirmado) |
| PATCH | `/api/admin/agendamentos/:id` | Muda a situação (confirmar, concluir, faltou, cancelar) |
| PATCH | `/api/admin/agendamentos/:id/horario` | Remarca data, horário ou barbeiro |
| GET | `/api/admin/relatorio?inicio=&fim=` | Relatório por barbeiro no período |
| GET | `/api/saude` | Verificação de funcionamento (usada pela hospedagem) |

## Implantação (produção)

Cloudflare Worker (site + API) + Supabase (banco) + Resend (e-mail), com deploy e backup noturno
no GitHub Actions. Tudo no plano grátis. Passo a passo e lista de segredos em [DEPLOY.md](DEPLOY.md).

## Manutenção

- **Novo usuário:** com `DATABASE_URL` no `.env`, `npm run usuario -- --nome "Ana" --email ana@novaera.com.br --senha "senhaForte123" --papel barbeiro --barbeiro 2`
- **Backup:** todo dia às 02:30 (Brasília) o GitHub Actions salva o banco no Cloudflare R2 e guarda 30 dias. Para restaurar, veja [DEPLOY.md](DEPLOY.md).
- **LGPD:** todo dia o sistema anonimiza nome e telefone de clientes sem atendimento há mais de 180 dias.
- **Feriados e horário:** edite `FUNCIONAMENTO` em `public/js/regras.js` (vale para o site e o servidor).
