# Push com o site fechado: passo a passo

O site é estático (GitHub Pages) e não pode avisar sozinho quando está fechado. O push resolve isso com uma
**função do Supabase** que roda a cada 5 minutos, vê o que vence para você hoje e manda uma notificação ao seu
aparelho no horário escolhido (padrão: 08:00 e, se quiser, uma da noite). Funciona com o navegador e o site fechados.

**O que sai do seu aparelho para o servidor:** a inscrição de push do aparelho e um resumo diário com *quantidades*
(revisões, erros e flashcards pendentes, e o trecho de lei seca do dia), os horários de aviso e o fuso. As anotações, os
enunciados e o resto do seu estudo não são lidos pela função.

> Não consegui testar a função contra um projeto Supabase real. A lógica dela (horários, fusos, janelas, envio único,
> remoção de inscrições mortas) tem testes automáticos (`node tests/push-tests.js`), mas a entrega de verdade depende
> destes passos. O botão **Testar push** (passo 8) confirma tudo de ponta a ponta.

## Requisitos

- O site publicado em **HTTPS** (GitHub Pages já é) e você entrando com sua **conta online** (aba Conta).
- Navegador com push: Chrome/Edge/Firefox no computador e no Android. No **iPhone** (iOS 16.4 ou mais novo), só com o
  site instalado na Tela de Início.
- Node.js instalado no seu computador (só para gerar as chaves e usar a CLI do Supabase).

## 1. Criar as tabelas

No painel do Supabase: **SQL Editor** > cole o conteúdo de `supabase-push.sql` (a parte de cima, sem as linhas
comentadas do agendamento) > **Run**. Isso cria `push_subscriptions` e `reminder_digests`, com acesso restrito a cada usuário.

## 2. Gerar as chaves VAPID

```bash
npx web-push generate-vapid-keys
```

Anote a **Public Key** e a **Private Key**. A privada é um segredo: nunca vai para o repositório.

## 3. Colocar a chave pública no site

Em `supabase-config.js`, preencha:

```js
vapidPublicKey: "COLE_AQUI_A_PUBLIC_KEY",
```

Faça commit e publique. (Com o campo vazio, o push fica desligado e a tela explica isso.)

## 4. Preparar a CLI do Supabase

Na pasta do projeto:

```bash
npx supabase login
npx supabase init          # responda "não" às perguntas de editor; não mexe na pasta supabase/functions
npx supabase link --project-ref SEU_PROJECT_REF
```

`SEU_PROJECT_REF` é o trecho antes de `.supabase.co` na `url` do `supabase-config.js`.

## 5. Criar os segredos da função

Primeiro gere o segredo do agendador e **copie o resultado** (você vai usá-lo de novo no passo 7):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Depois grave os segredos (troque pelos seus valores):

```bash
npx supabase secrets set \
  VAPID_PUBLIC_KEY="a Public Key" \
  VAPID_PRIVATE_KEY="a Private Key" \
  VAPID_SUBJECT="mailto:seu@email.com" \
  CRON_SECRET="o valor gerado acima"
```

## 6. Implantar a função

```bash
npx supabase functions deploy send-reminders --no-verify-jwt
```

O `--no-verify-jwt` é necessário porque o agendador chama a função com o `CRON_SECRET` e não com um login. A própria
função recusa quem não trouxer o segredo do agendador ou um login válido (e, com login, só aceita o modo de teste).

## 7. Agendar a cada 5 minutos

No painel: **Database > Extensions** e ative **pg_cron** e **pg_net**. Depois, no **SQL Editor**, rode (troque
`SEU_PROJECT_REF` e `SEU_CRON_SECRET`):

```sql
select cron.schedule(
  'estudos-track-send-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'SEU_CRON_SECRET'),
    body := '{}'::jsonb
  );
  $$
);
```

Para desligar depois: `select cron.unschedule('estudos-track-send-reminders');`

## 8. Ativar e testar no app

1. Abra o site, entre na conta online e vá em **Revisão > Lembretes automáticos > Push com o site fechado**.
2. **Ativar push neste aparelho** e permita as notificações.
3. **Testar push**: uma notificação deve chegar em alguns segundos. Faça isso em cada aparelho que quiser avisar.

| Resposta do teste | O que significa |
|---|---|
| "Push de teste enviado..." | Está tudo certo. |
| "A função send-reminders não foi encontrada" | Faltou o passo 6 (implantar a função). |
| "Faltam segredos da função" | Faltou o passo 5 (segredos VAPID). |
| "Nenhum aparelho com push ativo" | Ative o push neste aparelho (passo 8.2). |
| "O serviço de push recusou o envio" | Veja os logs: `npx supabase functions logs send-reminders`. Chaves VAPID trocadas depois de ativar exigem desativar e ativar de novo. |
| "O push com o site fechado ainda não foi configurado" | Falta a chave pública no `supabase-config.js` (passo 3). |

## Como funciona (e limites)

- O app envia o resumo dos próximos 30 dias sempre que algo muda (com alguns segundos de espera). Por isso o aviso
  reflete o que você já fez: se zerar as revisões do dia, nada é enviado.
- Cada horário (manhã e noite) gera no máximo um aviso por dia. Se o agendador atrasar, o aviso ainda sai até 3 horas depois
  do horário; passada a janela, ele é pulado.
- Se você ficar mais de 14 dias sem abrir o app, os avisos param (para não insistir à toa). Ao voltar, tudo é reenviado.
- O horário vale no fuso do aparelho em que você usou o app por último.
- Inscrições que o navegador invalidou (erros 404/410) são apagadas automaticamente.
- O push depende do serviço do navegador (Google, Mozilla, Apple). A entrega é "melhor esforço": economia de bateria ou
  modo "não perturbe" podem atrasar ou silenciar.
- Custo: a função roda 288 vezes por dia, bem abaixo do limite do plano gratuito.
