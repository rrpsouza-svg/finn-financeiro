# finn. · Controle Financeiro do Casal

App com login, banco de dados na nuvem compartilhado e assistente de IA.

---

## PASSO 1 — Configurar o Supabase (banco de dados + login)

### 1.1 Criar conta
- Acesse https://supabase.com e crie uma conta gratuita

### 1.2 Criar projeto
- Clique em **"New Project"**
- Nome: `finn`
- Crie uma senha forte e guarde (não precisa usar depois)
- Região: **South America (São Paulo)**
- Clique em **"Create new project"** — aguarde ~1 minuto

### 1.3 Criar a tabela de transações
- No menu lateral, clique em **"SQL Editor"**
- Clique em **"New query"**
- Cole o código abaixo e clique em **"Run"**:

```sql
create table transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users,
  date date not null,
  desc text not null,
  cat text not null,
  value numeric not null,
  type text not null,
  src text default 'manual',
  created_at timestamp default now()
);

-- Qualquer usuário logado pode ver e editar todas as transações (conta compartilhada)
alter table transactions enable row level security;

create policy "Usuarios logados acessam tudo"
  on transactions for all
  using (auth.role() = 'authenticated');
```

### 1.4 Pegar as credenciais
- No menu lateral, clique em **"Project Settings"** (ícone de engrenagem)
- Clique em **"API"**
- Copie e guarde:
  - **Project URL** (começa com `https://`)
  - **anon public key** (começa com `eyJ...`)

---

## PASSO 2 — Deploy no Vercel

1. Acesse https://vercel.com e faça login
2. Clique em **"Add New Project"**
3. Clique em **"Upload"** e arraste a pasta **finn2**
4. Clique em **"Deploy"** — aguarde ~1 minuto

---

## PASSO 3 — Configurar as variáveis de ambiente no Vercel

1. Após o deploy, vá em **Settings → Environment Variables**
2. Adicione as seguintes variáveis (clique em "Add" para cada uma):

| Name | Value |
|------|-------|
| `REACT_APP_SUPABASE_URL` | URL do Supabase (Passo 1.4) |
| `REACT_APP_SUPABASE_ANON_KEY` | anon key do Supabase (Passo 1.4) |
| `REACT_APP_ANTHROPIC_KEY` | sua chave da API Anthropic (opcional — só para IA) |

3. Após salvar, vá em **Deployments → Redeploy**

---

## PASSO 4 — Criar as contas de usuário

1. Abra o app no link do Vercel
2. Clique em **"Criar conta"**
3. Crie uma conta para você com seu e-mail
4. Crie uma conta para sua esposa com o e-mail dela
5. Os dois acessam as mesmas transações (conta compartilhada)

---

## Pronto!
O app estará disponível no link do Vercel.
Adicione à tela inicial do celular para usar como app.
