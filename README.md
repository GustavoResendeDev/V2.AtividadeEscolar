# Nova Era Barbearia — Sistema de Agendamento

Sistema web da Nova Era Barbearia (Goiânia – GO): site institucional, agendamento online com
banco de dados e painel para a equipe organizar a agenda.

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
- **Back-end:** Node.js 22 + Express 4 (API REST).
- **Banco de dados:** SQLite, pelo módulo nativo `node:sqlite` (sem instalar nada além do Node).
- **Testes:** `node:test` (unitários e de API) + Playwright (ponta a ponta e responsividade).
- **Implantação:** Render (arquivo `render.yaml`) ou Docker (`Dockerfile`); CI no GitHub Actions.

## Como rodar no seu computador

Pré-requisito: [Node.js 22.5 ou mais novo](https://nodejs.org/).

```bash
npm install
```

```bash
npm start
```

Abra <http://localhost:3000>. Na primeira execução o banco é criado em `dados/novaera.db`, já com
os serviços e barbeiros da casa, e são criados logins de demonstração (senha `novaera2026`):

| Login | Papel |
| --- | --- |
| `admin@novaera.com.br` | Administrador (vê todos os barbeiros) |
| `rafael@novaera.com.br`, `thiago@novaera.com.br`, `caio@novaera.com.br` | Barbeiro (vê só a própria agenda) |

> Os logins de demonstração só existem fora de produção. Em produção, o administrador é criado
> pelas variáveis `ADMIN_EMAIL` e `ADMIN_SENHA`.

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
server/
  index.js         ponto de entrada (servidor + manutenção diária)
  app.js           rotas da API e segurança (CSP, cabeçalhos, erros)
  agenda.js        regras de negócio: horários livres, conflitos, status, LGPD
  auth.js          senhas (scrypt), sessões e limite de tentativas
  db.js            criação das tabelas e dados iniciais
scripts/           criar usuário e fazer backup
tests/             unit/, api/ e e2e/
docs/              documentação do projeto, manual, slides e diagramas
```

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/servicos` | Serviços ativos (nome, duração, preço) |
| GET | `/api/barbeiros` | Barbeiros ativos |
| GET | `/api/disponibilidade?data=&servico=&barbeiro=` | Horários livres do dia |
| POST | `/api/agendamentos` | Cria um agendamento (devolve código e link do WhatsApp) |
| POST | `/api/admin/login` · `/api/admin/logout` | Entrar e sair do painel |
| GET | `/api/admin/agendamentos?data=&barbeiro=&status=` | Agenda do dia + indicadores |
| PATCH | `/api/admin/agendamentos/:id` | Muda a situação (confirmar, concluir, faltou, cancelar) |
| GET | `/api/saude` | Verificação de funcionamento (usada pela hospedagem) |

## Implantação (produção)

1. Crie uma conta no [Render](https://render.com) e escolha **New › Blueprint** apontando para este repositório.
2. O `render.yaml` cria o serviço com um disco persistente para o banco.
3. Preencha `ADMIN_EMAIL` e `ADMIN_SENHA` (senha forte, com 8 ou mais caracteres).
4. Depois do deploy, acesse `/admin/` e entre com esse login.

Com Docker:

```bash
docker build -t nova-era .
```

```bash
docker run -p 3000:3000 -v nova-era-dados:/dados -e ADMIN_EMAIL=admin@seudominio.com.br -e ADMIN_SENHA=troque-esta-senha nova-era
```

## Manutenção

- **Novo usuário:** `npm run usuario -- --nome "Ana" --email ana@novaera.com.br --senha "senhaForte123" --papel barbeiro --barbeiro 2`
- **Backup:** `npm run backup` (cópia consistente do banco em `backups/`, mantém os 30 mais recentes).
- **LGPD:** todo dia o sistema anonimiza nome e telefone de clientes sem atendimento há mais de 180 dias.
- **Feriados e horário:** edite `FUNCIONAMENTO` em `public/js/regras.js` (vale para o site e o servidor).
