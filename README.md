# estudos track

Aplicativo web estático para controle de estudos para concursos, com:

- matérias e assuntos;
- aba de edital para colar/importar PDF, TXT ou HTML, filtrar o conteúdo programático do cargo/área, separar matérias cobradas de regras administrativas e gerar cronograma neutro até a prova;
- controle de questões, acertos e erros;
- logo "Estudos Track" aplicada no layout, clicável para voltar ao Painel, e configurada como ícone da aba do navegador;
- controle por dia, semana, mês e ano com seleção de período específico;
- objetivos com data-alvo e contagem regressiva;
- jurisprudências separadas por STJ e STF, com busca por texto, matéria e assunto;
- editor avançado em jurisprudências, leis e tabelas, com negrito, itálico, sublinhado, cores rápidas, marca-texto, alinhamento, parágrafos, tabelas editáveis e imagens;
- edição e exclusão individual de julgados e flashcards cadastrados;
- leis e tabelas de apoio cadastradas pelo usuário na aba Jurisprudências;
- colagem de tabelas vindas do Word, Excel ou editores de texto, com cópia para colar de volta no Word e exportação CSV;
- editor de documento oficial em leis, tabelas e jurisprudências, com negrito, itálico, sublinhado, alinhamento, tabelas editáveis e cores pré-fixadas;
- busca própria em leis, tabelas e imagens por texto, matéria e assunto;
- cadastro de imagens/fotos em Jurisprudências, com cópia e download;
- Pomodoro por matéria, com assunto opcional, registro de tempo, lofi tic-tac opcional, alarme ao terminar cada etapa, botão para pular etapa e descanso longo configurável;
- player de foco por link do YouTube ou Spotify;
- flashcards por matéria ou por assunto, com revisão por dificuldade, acertos, erros, repetição por contagem de cartões, sorteio aleatório de pendentes e filtro por matéria/assunto;
- anotações em layout de caderno, com marca-texto, categorias e fonte externa vinculada;
- fontes/sites com texto hospedado no app, grifos salvos, sincronização por link quando permitida, limpeza de texto e edição/exclusão;
- perfis locais separados por usuário no mesmo navegador, com entrada por nome e PIN sem lista pública de perfis;
- modo claro e modo escuro, com reforço de legibilidade para textos colados, jurisprudências, tabelas e editores;
- botão discreto para voltar ao topo da página após rolagem;
- exportação, importação e backup dos dados em JSON.
- reset global de estatísticas sem apagar cadastros, fontes e anotações.

## Como publicar no GitHub

1. Crie um repositório novo no GitHub.
2. Envie estes arquivos para a raiz do repositório:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `netlify.toml`
   - `CNAME` se for usar domínio personalizado no GitHub Pages
   - `README.md`
3. Faça o commit e publique.

## Como publicar no Netlify

### Opção rápida

1. Acesse https://app.netlify.com/drop.
2. Arraste a pasta do projeto inteira para a tela.
3. O Netlify vai gerar um link público.

### Opção com GitHub

1. No Netlify, escolha **Add new site**.
2. Escolha **Import an existing project**.
3. Conecte sua conta do GitHub.
4. Selecione o repositório do projeto.
5. Use estas configurações:
   - Build command: deixe em branco.
   - Publish directory: `.`
6. Clique em **Deploy**.

## Dados de cada usuário

O app é estático e salva os dados no navegador usando `localStorage`.
Cada perfil tem seu próprio espaço de dados, identificado por **nome de perfil** e **PIN**.

Se mais de uma pessoa usar o mesmo computador ou navegador, cada uma deve entrar pelo próprio **nome de perfil** e **PIN** no painel **Acesso individual**.
O app não mostra uma lista de perfis cadastrados: o usuário digita o nome e o PIN para entrar ou criar seu próprio espaço.
Ao abrir o site, o conteúdo fica bloqueado e zerado até alguém entrar em um perfil.
Perfil novo sempre começa vazio, sem importar dados antigos ou dados de outro usuário.
Depois que o usuário usa o app, as matérias, questões, flashcards, anotações e demais dados ficam salvos apenas naquele perfil local.
Mesmo que o usuário fique muito tempo sem usar, os dados permanecem salvos no navegador enquanto o armazenamento do site não for apagado; basta digitar o mesmo nome de perfil e PIN para reabrir.

Para levar dados para outro navegador, computador ou celular, use os botões **Exportar** e **Importar** dentro do app.
Também existe uma aba **Conta** com login local e geração/restauração de backup.

Para sincronizar automaticamente entre dispositivos com login e senha, será necessário adicionar um backend, como Supabase, Firebase ou outro banco com autenticação.

## Supabase para login online

Esta versão já vem preparada para Supabase. Enquanto `supabase-config.js` estiver vazio, o app continua funcionando com perfis locais por nome e PIN. Depois de configurar o Supabase, o painel **Acesso individual** passa a usar e-mail e senha, e cada usuário só carrega os próprios dados.

Passos:

1. Crie um projeto em https://supabase.com.
2. No painel do Supabase, abra **SQL Editor** e rode o conteúdo do arquivo `supabase-schema.sql`.
3. Em **Project Settings > API**, copie a **Project URL** e a chave **anon public**.
4. Abra `supabase-config.js` e preencha:

```js
window.ESTUDOS_TRACK_SUPABASE = {
  url: "https://SEU-PROJETO.supabase.co",
  anonKey: "SUA_CHAVE_ANON_PUBLIC",
  table: "study_profiles",
};
```

5. Publique novamente no GitHub Pages.

O isolamento dos dados acontece pela tabela `study_profiles` e pelas políticas de Row Level Security. Cada linha usa `user_id = auth.uid()`, então uma conta autenticada só consegue ler, salvar, atualizar ou excluir a própria linha.

Para recuperação de senha, configure também em **Authentication > URL Configuration** no Supabase:

- **Site URL**: `https://estudostrack.com.br`
- **Redirect URLs**: `https://estudostrack.com.br`

Depois disso, o botão **Esqueci a senha** envia um link para o e-mail do usuário. Ao abrir o link, o usuário volta ao Estudos Track e define uma nova senha na aba **Conta**.

## Pomodoro com alarme

O Pomodoro toca um alarme curto quando cada bloco termina: foco, pausa curta ou descanso longo.
Também há um lofi de tic-tac opcional, gerado pelo navegador, com botão para ligar ou desligar.
Durante o descanso, o círculo do temporizador mostra uma animação.

Por padrão, o app usa 25 minutos de foco, 5 minutos de pausa curta e 30 minutos de descanso longo a cada 120 minutos ou rodada configurada.
Na própria aba **Pomodoro**, o usuário pode alterar foco, pausa curta, descanso longo, intervalo do descanso longo e ciclos por rodada.
Para iniciar ou registrar tempo manualmente, basta escolher a matéria; o assunto específico continua disponível, mas é opcional.
O botão **Pular etapa** permite avançar manualmente do foco para o descanso ou do descanso para o próximo foco.

## Reset de estatísticas

Na aba **Conta**, o botão **Zerar estatísticas do site** limpa histórico de tempo, questões, relatórios e estatísticas de revisão dos flashcards.
Ele mantém matérias, assuntos, fontes, anotações, objetivos e os flashcards cadastrados.

## Controle por período e objetivos

A aba **Controle** permite selecionar:

- um dia específico;
- uma semana de referência;
- um mês específico;
- um ano específico.

Os dados exibidos mudam de acordo com o período escolhido.
Na mesma aba é possível cadastrar objetivos, como data de prova, revisão final ou qualquer meta pessoal, com contagem de dias restantes.

## Jurisprudências

A aba **Jurisprudências** separa julgados de STJ e STF.
Os julgados cadastrados pelo usuário podem ser pesquisados por texto livre, matéria e assunto vinculado.
O filtro funciona sobre título, tema, tese/resumo, fonte, matéria e assunto.
Cada julgado pode receber hashtags, como `#tema1199` ou `#improbidade`, e essas tags também entram na pesquisa.
Os julgados podem ser editados depois de salvos, mantendo o texto formatado com cores rápidas, marca-texto, alinhamento, parágrafos, tabelas coladas do Word/Excel e imagens.
Ao cadastrar jurisprudência, lei ou tabela, é possível escolher apenas a matéria e deixar o assunto em branco.
Na mesma aba, o usuário também pode cadastrar leis, tabelas de apoio e imagens/fotos, vinculando cada item a uma matéria/assunto quando quiser.
Esses materiais possuem busca própria por texto, matéria e assunto e podem ser excluídos individualmente.
O editor de leis, tabelas e jurisprudências permite preservar e ajustar formatação de documento oficial, com negrito, itálico, sublinhado, alinhamento, parágrafos, tabelas editáveis e cores rápidas: vermelho, verde, amarelo, azul e cor original.
Para tabelas, cada linha pode usar colunas separadas por `|`, `;` ou tabulação.
Também é possível colar tabela diretamente do Word, Excel ou editor de texto; o app mantém a tabela editável quando o navegador entrega HTML da tabela.
Cada tabela salva possui botões para copiar como tabela compatível com Word, copiar como texto e baixar em CSV.
Imagens/fotos podem ser escolhidas por arquivo ou coladas no campo do material, e depois copiadas ou baixadas pelo card.

## Flashcards por dificuldade

Cada flashcard pode ser marcado como:

- **Difícil**: repete a cada 4 cartões revisados por padrão.
- **Média**: repete a cada 8 cartões revisados por padrão.
- **Fácil**: repete a cada 12 cartões revisados por padrão.

Esses números podem ser alterados pelo próprio usuário na aba **Flashcards**, no painel **Intervalos por dificuldade**.

Na mesma aba, o painel **Escolher revisão** permite estudar:

- todos os flashcards pendentes;
- apenas uma matéria;
- apenas um assunto.

Também é possível escolher entre **Sortear pendentes** e **Fila por vencimento**.
Mesmo no modo aleatório, o app só sorteia cartões que já estão pendentes conforme a regra de repetição da dificuldade.
Ao cadastrar flashcards, a matéria é obrigatória e o assunto é opcional.
Cada flashcard pode ser editado individualmente, com frente e verso em texto formatado por cores, marca-texto, alinhamento e parágrafos.

## Anotações e fontes

A aba **Anotações** funciona como um caderno de estudos: a coluna esquerda reúne cadastro e lista rolável de fontes, a área principal mostra a fonte vinculada e a parte inferior fica para escrever e consultar anotações.
Ela permite cadastrar sites usados como base, como Planalto, tribunais, PDFs hospedados ou páginas de lei.
As fontes podem ser divididas por categoria e vinculadas às anotações.

Cada fonte possui um campo de texto hospedado no app: cole ali o trecho da lei ou do site, selecione a parte desejada e aplique marca-texto.
Os grifos ficam salvos na própria fonte dentro do app e continuam vinculados ao link original cadastrado.

O editor de fonte e o editor de anotação possuem marca-texto em amarelo, verde, azul e cor personalizada.
Também é possível editar ou excluir fontes/sites cadastrados e criar/excluir categorias.
Cada card de fonte possui botão para excluir a fonte inteira. Na fonte selecionada, também há botões para limpar apenas o texto/grifos salvos ou excluir a fonte inteira.

Para carregar o texto de uma fonte, use uma destas opções:

- **Importar texto do link**: o app tenta buscar o conteúdo do site e colocar no leitor da fonte.
- **Colar manualmente**: copie o trecho do site original e cole no leitor da fonte.

Ao ativar **Tentar sincronizar automaticamente pelo link**, o app verifica a fonte quando ela puder ser lida pelo navegador.
Se o texto ainda não tiver grifos, a atualização pode entrar automaticamente.
Se já houver grifos, o app preserva sua versão marcada e mostra uma atualização disponível para aplicação manual.

Alguns sites oficiais podem bloquear visualização ou sincronização dentro do app.
Nesse caso, use o botão **Abrir site base**, copie o trecho necessário e cole manualmente no leitor da fonte.
