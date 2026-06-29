# ymcontrole de estudos

Aplicativo web estático para controle de estudos para concursos, com:

- matérias e assuntos;
- controle de questões, acertos e erros;
- controle por dia, semana, mês e ano com seleção de período específico;
- objetivos com data-alvo e contagem regressiva;
- jurisprudências separadas por STJ e STF;
- Pomodoro com registro de tempo, alarme ao terminar cada etapa e animação de pausa;
- player de foco por link do YouTube ou Spotify;
- flashcards com revisão por dificuldade, acertos, erros, repetição por contagem de cartões, sorteio aleatório de pendentes e filtro por matéria/assunto;
- exclusão individual de flashcards;
- anotações em layout de caderno, com marca-texto, categorias e fonte externa vinculada;
- fontes/sites com texto hospedado no app, grifos salvos, sincronização por link quando permitida, limpeza de texto e edição/exclusão;
- perfis locais separados por usuário no mesmo navegador, com entrada por nome e PIN sem lista pública de perfis;
- modo claro e modo escuro;
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
2. Arraste a pasta `ymcontrole-de-estudos` inteira para a tela.
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
Isso significa que cada pessoa que abrir o site em seu próprio navegador terá dados separados.

Se mais de uma pessoa usar o mesmo computador ou navegador, cada uma deve entrar pelo próprio **nome de perfil** e **PIN** no painel **Acesso individual**.
O app não mostra uma lista de perfis cadastrados: o usuário digita o nome e o PIN para entrar ou criar seu próprio espaço.
Ao abrir um novo acesso sem sessão ativa, o conteúdo fica bloqueado até alguém entrar em um perfil.

Para levar dados para outro navegador, computador ou celular, use os botões **Exportar** e **Importar** dentro do app.
Também existe uma aba **Conta** com login local e geração/restauração de backup.

Para sincronizar automaticamente entre dispositivos com login e senha, será necessário adicionar um backend, como Supabase, Firebase ou outro banco com autenticação.

## Pomodoro com alarme

O Pomodoro toca um alarme curto quando o foco termina, quando a pausa termina e quando todos os ciclos acabam.
Durante a pausa, o círculo do temporizador mostra uma animação de descanso.
O som é gerado pelo navegador e começa a funcionar depois que o usuário clica em **Iniciar**.

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
