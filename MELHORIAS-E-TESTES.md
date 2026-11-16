# Melhorias recentes e testes

## Conta e seguranca

- A aba **Conta** mostra o status da conta, tipo de armazenamento, ultimo salvamento e backup.
- O botao **Salvar agora** forca a gravacao local ou no Supabase.
- O botao **Excluir meus dados** apaga os dados de estudo do perfil atual.
- No Supabase, a exclusao remove a linha da tabela `study_profiles`; para remover tambem o usuario de autenticacao, use **Authentication > Users** no painel do Supabase.
- O arquivo `supabase-schema.sql` inclui RLS, politicas por `auth.uid()`, coluna de e-mail e trigger de `updated_at`.

## Painel e edital

- A tela inicial possui **Revisao diaria sugerida**, com atalhos para edital, flashcards, reforco e controle do dia.
- A aba **Edital** permite remover assuntos detectados incorretamente.
- A mesma aba permite adicionar materia/assunto manualmente antes de importar para o plano.
- Os seletores principais de materia e assunto voltaram ao formato nativo, mais compacto e sem sobrepor os botoes de salvar/aplicar.

## Teste rapido

Com Node.js disponivel, rode dentro da pasta do projeto:

```bash
node tests/smoke-tests.js
```

Esse teste confere a sintaxe do `app.js`, telas principais, acoes de conta, seletores nativos e politicas do SQL.

## Ciclo de estudos (novembro/2026)

- Novas abas **Caderno de erros**, **Revisão** e **Lei seca**, mais a faixa do ciclo no Painel e cartões no **Revisão diária sugerida**.
- Novos dados no estado: `revisions`, `errorNotebook`, `lawPlans` e `cycleSettings`. Backups antigos continuam abrindo (campos ausentes entram vazios).
- A busca global encontra erros do caderno e planos de lei seca.
- `node tests/ciclo-tests.js` cobre a lógica de revisão e do cronograma (atraso, leitura a mais ou a menos, várias leituras, prazo vencido, dia de folga).

## Lembretes automáticos (novembro/2026)

- Banner de pendências, selo no título da aba, notificações por horário, app instalável (`manifest.json` + `sw.js`), agenda `.ics` e trilha de fixação.
- **Redistribuir atrasadas** com limite diário (`cycleSettings.dailyLimit`).
- `node tests/ciclo-tests.js` agora também cobre redistribuição, texto do aviso e geração do `.ics` (escape, dobra de linhas em 75 octetos com UTF-8, CRLF, alarme e virada de dia).
- Nos testes no navegador com Playwright, o service worker passa a controlar a página após o primeiro carregamento; use `context.route` (e não `page.route`) para interceptar o `supabase-config.js`.

## Hoje, plano semanal, reforço e backup (novembro/2026)

- Nova tela **Hoje** como início; o painel antigo virou **Visão geral**. O app sempre abre em Hoje.
- Menu lateral agrupado, com contadores; no celular, barra inferior e painel **Mais**. Antes, no celular, o menu virava uma lista longa acima do conteúdo; também foi compactado o cabeçalho (de 684 px para cerca de 154 px).
- Sem login, o formulário de acesso continua visível no celular (a barra inferior e o painel só existem após entrar).
- Novos campos em `cycleSettings`: `autoWeak`, `weakAccuracy`, `weakMinQuestions`, `backupDays`, `studyWeekdays` e `weights`. Nova revisão do tipo `weak` (reforço).
- `node tests/hoje-tests.js` cobre plano semanal, pesos do edital, reforço por desempenho (com intervalo de reavaliação), motivo recorrente de erro e regras do lembrete de backup.
- Nos testes com Playwright, no celular o menu fica atrás do botão **Mais** (`#menuToggleBtn`).

## Push real, registro rápido, flashcards em Hoje, agenda e CI (novembro/2026)

- **Push com o site fechado:** função `supabase/functions/send-reminders` (agendada a cada 5 min), tabelas `push_subscriptions` e `reminder_digests` (`supabase-push.sql`, com RLS), cliente `push.js` e evento `push` no `sw.js`. Configuração em `PUSH-SETUP.md`. A lógica de horários/fusos fica em `supabase/functions/_shared/reminder-core.mjs`, testada em Node, e o texto do aviso é idêntico ao do app (há teste de paridade).
- **Registro rápido de estudo** na tela Hoje (botão no topo e por matéria no "Estudo do dia").
- **Flashcards em Hoje:** novo cartão, contador no menu, etapa do "Começar o dia", notificação e agenda.
- **Agenda `.ics`:** 90 dias, com etapas futuras previstas de revisões e erros. Revisões atrasadas são projetadas a partir de hoje.
- **CI:** `.github/workflows/tests.yml`, `package.json` e roteiros de navegador em `tests/e2e/` (rodam com `npm run test:e2e`).
- Service worker: cache `estudos-track-v2`.
- Limite conhecido: a função de push e a entrega real não foram exercitadas contra um projeto Supabase de verdade (só simuladas); use "Testar push" ao configurar.

## Dizer o que estudou ao terminar o Pomodoro (novembro/2026)

- Novo módulo `sessao.js` e janela "O que você estudou?" (`#sessionModal`): escolha ou criação de matéria e assunto na hora de salvar o tempo; sessões sem destino ficam em `localStorage` (por perfil, só neste aparelho) até serem salvas.
- O Pomodoro inicia sem matéria; `logPomodoroFocus` passa por `sessionAskBeforeSave`. Opção `cycleSettings.askAtSave` (padrão ligada).
- Registro manual (`#studyNewTopic`) e registro rápido (`#qsNewTopic`) aceitam assunto novo digitado; nome igual a um existente reaproveita o existente.
- `.toast` passou a `z-index: 100` para aparecer acima da janela.
- Testes: `tests/sessao-tests.js` (14) e `tests/e2e/sessao.e2e.js`, que também pegaram, antes da entrega, dois defeitos corrigidos: "novo assunto" em branco salvava sem aviso e o contador da fila não atualizava com a janela aberta.
