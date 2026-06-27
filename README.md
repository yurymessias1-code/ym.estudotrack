# ymcontrole de estudos

Aplicativo web estático para controle de estudos para concursos, com:

- matérias e assuntos;
- controle de questões, acertos e erros;
- controle por dia, semana, mês e ano;
- jurisprudências separadas por STJ e STF;
- Pomodoro com registro de tempo;
- player de foco por link do YouTube ou Spotify;
- flashcards com revisão por dificuldade, acertos, erros e repetição por contagem de cartões;
- anotações com marca-texto, categorias e fonte externa vinculada;
- perfis locais separados por usuário no mesmo navegador;
- exportação e importação dos dados em JSON.

## Como publicar no GitHub

1. Crie um repositório novo no GitHub.
2. Envie estes arquivos para a raiz do repositório:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `netlify.toml`
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

Se mais de uma pessoa usar o mesmo computador ou navegador, use o painel **Perfil** na lateral para criar um perfil local diferente para cada pessoa.

Para levar dados para outro navegador, computador ou celular, use os botões **Exportar** e **Importar** dentro do app.

Para sincronizar automaticamente entre dispositivos com login e senha, será necessário adicionar um backend, como Supabase, Firebase ou outro banco com autenticação.

## Flashcards por dificuldade

Cada flashcard pode ser marcado como:

- **Difícil**: repete a cada 4 cartões revisados por padrão.
- **Média**: repete a cada 8 cartões revisados por padrão.
- **Fácil**: repete a cada 12 cartões revisados por padrão.

Esses números podem ser alterados pelo próprio usuário na aba **Flashcards**, no painel **Intervalos por dificuldade**.

## Anotações e fontes

A aba **Anotações** permite cadastrar sites usados como base, como Planalto, tribunais, PDFs hospedados ou páginas de lei.
As fontes podem ser divididas por categoria e vinculadas às anotações.

O editor de anotação possui marca-texto em amarelo, verde e azul.
Alguns sites oficiais podem bloquear a visualização dentro do app; nesse caso, use o botão **Abrir site base** e atualize a anotação manualmente com base na fonte original.
