# ymcontrole de estudos

Aplicativo web estático para controle de estudos para concursos, com:

- matérias e assuntos;
- controle de questões, acertos e erros;
- controle por dia, semana, mês e ano;
- jurisprudências separadas por STJ e STF;
- Pomodoro com registro de tempo;
- player de foco por link do YouTube ou Spotify;
- flashcards com revisão, acertos, erros e próxima data de revisão;
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

## Observação sobre os dados

Os dados ficam salvos no navegador de cada pessoa usando `localStorage`.
Para levar seus dados para outro navegador ou computador, use os botões **Exportar** e **Importar** dentro do app.
