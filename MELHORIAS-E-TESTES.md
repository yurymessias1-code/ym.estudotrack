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

## Imagens fora do estado, intervalos mais justos, prova e erro repetido (novembro/2026)

- **Imagens dos documentos (jurisprudências, leis/tabelas, fontes, anotações, flashcards):** não ficam mais em base64 dentro do estado. O arquivo (reduzido para no máximo 1600 px, webp/jpeg) vai para o IndexedDB e para o bucket `erro-prints` (o mesmo dos prints do caderno) e o texto guarda só `<img data-img-id="ID">`; o material de lei/tabela do tipo imagem guarda `ymimg:ID`. A tela carrega as imagens sozinha (`docImgObserve`). Backup em arquivo, "excluir meus dados" e sincronização já enxergam essas imagens (`erroAllPrintIds`).
- **Imagens antigas:** com a conta online, o app move sozinho as imagens em base64 que já estão no estado (`docImgMigrateState`, a cada rodada de sincronização). A troca só acontece depois de o envio ser confirmado; se o Storage falhar, a imagem continua onde estava. O id vem do conteúdo (SHA-256), então dois aparelhos chegam ao mesmo id e a mesma imagem usada em dois lugares vale um arquivo só.
- **Excluir ou trocar** um material de lei/tabela ou uma jurisprudência solta as imagens que ninguém mais usa (aparelho e nuvem). Imagens de anotações, fontes e flashcards não são apagadas da nuvem quando o item é excluído (ficam órfãs, ocupando pouco espaço).
- **Errar não zera tudo:** "esqueci" (revisões) e "errei de novo" (caderno) descem 2 etapas (`CYCLE_LAPSE_DROP`) em vez de voltar à primeira. Um item de 60 dias volta para 7 dias, não para 1.
- **Data da prova:** com a opção "Encurtar os intervalos conforme a prova se aproxima" (ligada por padrão, em Revisão → Intervalos do ciclo), a próxima revisão ou refação cai, no máximo, na metade do tempo que falta para a prova mais próxima que vale para a matéria (concursos sem matérias marcadas valem para todas). Com 1 dia sobrando, cai no dia da prova; nada é marcado depois dela. Os botões e avisos já mostram o intervalo ajustado.
- **Erro repetido:** ao salvar um erro cujo enunciado (sem acento, pontuação e maiúsculas, mínimo de 25 caracteres) já existe, o app pergunta se soma mais um erro no registro existente (reabre se estava dominado, desce 2 etapas, junta prints até o limite de 6, anotações e tags e preenche campos vazios) ou se salva como novo.
- **Testes:** `ciclo-tests` (53), `caderno-tests` (imagens de documentos) e os roteiros `tests/e2e/imagens.e2e.js` e `tests/e2e/protecao.e2e.js` (agora também erro repetido e data da prova).

## Carga do dia (novembro/2026)

- **Nivelar ao agendar:** ao marcar a próxima revisão ou refação, o app olha os dias perto do previsto (nada nos intervalos de 1 e 2 dias, 1 dia a mais ou a menos até 14 dias, 2 dias nos mais longos) e escolhe o que tem menos itens. A carga do dia conta revisões abertas e erros não dominados. Só troca se o outro dia for realmente mais vazio; em empate fica o previsto e, entre vizinhos iguais, o mais cedo. A data da prova continua mandando: o nivelamento nunca passa do dia limite. Os botões e avisos já mostram o dia nivelado ("ajustado para um dia mais leve").
- **Opção:** Revisão → Intervalos do ciclo → "Distribuir revisões e erros nos dias mais leves" (ligada por padrão).
- **Redistribuir atrasados** agora inclui os erros do caderno: revisões e erros dividem o mesmo limite por dia, os mais antigos primeiro. Há botão também na tela do Caderno de erros, e o aviso do topo conta os dois.
- **Aba Hoje:** "Amanhã" passou a somar os erros que vencem amanhã às revisões.
- **Testes:** `ciclo-tests` (58) e `tests/e2e/protecao.e2e.js`.

## Contra a bola de neve de revisões (novembro/2026)

Por que acumulava: cada assunto estudado volta 4 vezes (1, 7, 30 e 60 dias) e cada erro 5, e tudo que vencia aparecia de uma vez, sem ligação com o seu limite por dia. Estudando poucos assuntos novos por dia, a fila estabiliza num valor alto; o atraso só cresce.

- **Fila do dia limitada (`cycleTodayQueue`):** aparece no máximo o limite por dia (padrão 12, ajustável), revisões e erros juntos, já descontando o que foi feito hoje. Entram primeiro os mais urgentes (`cyclePriority`: atraso até 30 pontos, erro reincidente, reforço e primeira revisão pesam mais). O resto aguarda e entra nos próximos dias, e quem fica muito tempo esperando acaba passando na frente de itens novos, então nada é esquecido. "Revisar mais 5 hoje" libera mais cinco quando você tem tempo. Contadores, avisos, sessão de revisão, aba Hoje e lembretes usam a fila limitada. Opção para desligar: "Limitar a fila do dia ao meu limite por dia".
- **Agendamento por capacidade (`cycleLevelGap` com `limit`, `cycleCapacityDueDate`):** ao marcar a próxima revisão, erro ou a primeira revisão de um assunto novo, se o dia previsto (e o melhor vizinho) já está no limite, usa o primeiro dia seguinte com vaga, dentro de uma folga (2 dias nos intervalos curtos, até 10 nos longos) e sem passar do dia limite da prova.
- **Mínimo para abrir revisão:** estudo de um assunto só abre revisões com pelo menos 20 minutos no dia (era 10; ajustável de 5 a 120 em "Minutos mínimos de estudo de um assunto para abrir revisões"). Toques rápidos de 10 a 19 minutos deixam de gerar uma cadeia de 4 revisões.
- **Aviso de ritmo sustentável (`cycleSteadyLoad`, `cycleSustainabilityNote`):** usa os assuntos e erros novos dos últimos 14 dias e quantas etapas tem cada escada para estimar quantas revisões por dia o seu ritmo vai gerar. Se passar do limite, a aba Hoje e a aba Revisão avisam e sugerem estudar menos assuntos novos por vez, aumentar o limite ou usar uma escada mais curta (ex.: 1, 7 e 30). Também avisa quando há itens aguardando espaço.
- **Testes:** `ciclo-tests` (64) e `tests/e2e/protecao.e2e.js` (passo 12: fila de 3 de 6, "Revisar mais 5 hoje", avisos na aba Hoje).
