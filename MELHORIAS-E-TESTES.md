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
- Os seletores principais de materia e assunto tem busca e lista rolavel para evitar menus gigantes.

## Teste rapido

Com Node.js disponivel, rode dentro da pasta do projeto:

```bash
node tests/smoke-tests.js
```

Esse teste confere a sintaxe do `app.js`, telas principais, acoes de conta, seletores pesquisaveis e politicas do SQL.
