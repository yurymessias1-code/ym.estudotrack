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

## Sincronização segura, mesclagem, relatórios e janela acessível (novembro/2026)

- **Sincronização:** `merge.js` (junção pura por id, lápides de exclusão por 90 dias e "revivido"), gravação condicional em `study_profiles` (`update ... eq(updated_at)` com o valor devolvido pelo servidor), junção ao detectar conflito, ao entrar e ao voltar à aba/ficar online. O cliente REST alternativo ganhou `update(...).eq(...).select(...)`. Estado: `meta.tombstones` e `meta.revivals`; ids guardados em `state.__ids` (fora do JSON).
- **Defeito encontrado e corrigido pelos testes:** `remoteStore.saveTimer` nunca era zerado depois de disparar; qualquer guarda do tipo "há salvamento pendente?" ficava sempre verdadeira.
- A "impressão digital" do estado ignora a ordem das listas e das chaves (sem isso, dois aparelhos com o mesmo conteúdo reenviariam um ao outro sem parar).
- **Mesclagem:** `mesclar.js`, desfazer que reverte só o que mudou; assuntos "gêmeos" só contam contra o que o destino já tinha.
- **Relatórios:** `retencao.js` (sequência, mapa de 12 semanas, aderência, retenção, carga de 14 dias e erros).
- **Janelas:** `modal.js` (foco preso, fundo inerte, foco devolvido), usado pela janela de sessão e pela de mesclagem.
- **Testes novos:** `merge-tests` (20), `mesclar-tests` (14), `retencao-tests` (12) e os roteiros `sync`, `mesclar` e `relatorios` em `tests/e2e/`; `tests/e2e/fake-supabase.js` é um Supabase falso em memória (autenticação, `study_profiles` com o carimbo de `updated_at` feito pelo servidor).
- Limite conhecido: a sincronização foi testada contra o Supabase falso (que reproduz o comportamento do PostgREST usado), não contra um projeto real. Antes de contar com ela, teste com dois aparelhos.

## Caderno de erros: anotações livres e prints na nuvem (novembro/2026)

- Cada erro tem o campo **Meu caderno** (texto formatado, colar explicações, prints no meio do texto). Só matéria + algum conteúdo são obrigatórios; "Resposta correta" é opcional. O filtro padrão da lista é **Todos**.
- Prints vão para o **Supabase Storage** (`supabase-storage.sql`, bucket `erro-prints`, pasta por usuário) com fila offline, download sob demanda em outro aparelho, exclusão junto com o erro e inclusão no backup em arquivo.
- `tests/e2e/prints-nuvem.e2e.js` usa o Supabase falso (agora com Storage) para cobrir envio, outro aparelho, exclusão, falha sem internet, backup/restauração e aviso de bucket ausente.
- Regra mantida: prints em base64 nunca entram no `state`; só no arquivo de backup (o teste de fumaça vigia isso).

## Proteção dos dados, uma cadeia de revisão por assunto e refação com 4 notas (novembro/2026)

- **Tudo na conta:** as sessões do Pomodoro ainda sem matéria agora ficam em `state.pendingSessions` (entram na junção entre aparelhos, no Supabase e no backup em arquivo). A cópia antiga que ficava só no `localStorage` é trazida para o estado na primeira leitura e removida.
- **Cofre auxiliar só no IndexedDB:** as cópias automáticas (a cada 10 minutos, 12 por perfil) e as de "manual" e "antes de restaurar" (6 por perfil, não são empurradas pelas automáticas) ficam no IndexedDB. Cópias antigas do `localStorage` são migradas e apagadas, liberando a cota. Só se o navegador não tiver IndexedDB sobram até 2 cópias locais.
- **Restaurar com segurança:** o backup (arquivo ou código) é conferido antes (JSON que não é backup é recusado), mostra o que vai entrar, pede confirmação e guarda uma cópia dos dados atuais no cofre antes de trocar. A cópia aparece na lista de recuperação da aba Conta. Os prints só são restaurados depois da confirmação.
- **Uma cadeia de revisão por assunto:** estudar o mesmo assunto em outro dia reaproveita a cadeia aberta (`absorbedKeys` guarda os dias juntados). Quem já tem cadeias repetidas vê o botão **Unificar revisões repetidas** na aba Revisão (fica a mais avançada de cada assunto).
- **Caderno de erros:** a refação tem 4 notas (Errei de novo, Acertei mas chutei/com dúvida, Acertei, Acertei fácil). "Com dúvida" não conta como erro e repete mais cedo; "fácil" aumenta o intervalo. Com 3 ou mais erros o item vira **Reincidente**, com atalhos para criar reforço do assunto, gerar flashcard e reescrever a regra. A fila de refação mostra os reincidentes primeiro.
- **Testes:** `ciclo-tests` (47), `sessao-tests` (16) e o roteiro `tests/e2e/protecao.e2e.js`.
- **Para os prints irem para a nuvem** é preciso ter rodado `supabase-storage.sql` no Supabase (uma vez).

## Histórico de versões da conta (novembro/2026)

- **Servidor:** `supabase-history.sql` (rodar uma vez no SQL Editor, depois do `supabase-schema.sql`) cria a tabela `study_profiles_history` e um gatilho que guarda a versão anterior a cada atualização da conta, no máximo uma a cada 2 horas. Ficam todas as versões das últimas 24 horas, depois a primeira de cada dia até 14 dias. As cópias "antes de restaurar" (feitas pelo app) ficam as 5 mais recentes. Cada pessoa só vê e apaga as suas; ninguém edita versões. Atenção ao espaço do plano gratuito: cada versão é uma cópia inteira dos dados.
- **Site:** aba Conta, **Versões na nuvem** → "Ver versões salvas" → "Voltar a esta versão". Antes de trocar, o app guarda uma cópia do que está aberto no cofre do navegador e no histórico da nuvem. A volta é de verdade: o que a versão não tem sai também dos outros aparelhos (vira exclusão lembrada) e o que ela tem e já tinha sido excluído volta (`mergeCarryForwardForRestore` em `merge.js`). Importar um backup em arquivo continua se juntando ao que há na nuvem.
- **Excluir meus dados** também apaga o histórico da conta.
- **Testes:** `merge-tests` (22) e o roteiro `tests/e2e/historico.e2e.js` (dois aparelhos contra o Supabase falso com a tabela de histórico).
