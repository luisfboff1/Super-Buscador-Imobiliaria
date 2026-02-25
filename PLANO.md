# Super Buscador Imobiliário — Plano de Desenvolvimento

> SaaS multi-tenant de busca imobiliária agregada: uma plataforma única para vasculhar centenas de imobiliárias ao mesmo tempo.

---

## 1. Visão Geral do Produto

O **Super Buscador Imobiliário** é uma plataforma SaaS B2C que agrega anúncios de múltiplas imobiliárias em uma interface única. O usuário cadastra as URLs das imobiliárias (manualmente, via Excel ou via extração automática do CRECI), e a plataforma realiza buscas inteligentes sobre todo esse banco de dados, retornando imóveis filtrados com link direto para o anúncio original.

### Problema resolvido
Hoje um comprador/investidor precisa vasculhar 200+ sites de imobiliárias de uma cidade para encontrar o imóvel ideal. O Super Buscador elimina esse atrito: uma busca, todos os resultados.

### Modelo de negócio
- **SaaS com assinatura mensal** por tenant (workspace)
- Plano inicial gratuito com limite de requisições
- Planos pagos com mais requisições, mais usuários e funcionalidades avançadas
- Custos de LLM (OpenAI/Gemini) absorvidos pela plataforma e embutidos no plano

---

## 2. Stack Tecnológico

> Versões verificadas em npmjs.com em 25/02/2026 — todas stable/latest.

| Camada | Tecnologia | Versão | Justificativa |
|---|---|---|---|
| **Framework** | Next.js (App Router) | `16.1.6` | SSR, Server Actions, API Routes, tudo em um repo |
| **Runtime UI** | React | `19.2.4` | Server Components, Actions, use() hook estável |
| **Linguagem** | TypeScript | `5.9.3` | Tipagem estrita end-to-end |
| **UI Components** | shadcn/ui + Radix UI | latest | Acessível, customizável, sem lock-in |
| **Estilização** | Tailwind CSS | `v4` | Utility-first, integrado ao shadcn |
| **Banco de dados** | Neon (PostgreSQL serverless) | — | Branching por tenant, escala automática, free tier |
| **ORM** | Drizzle ORM | `0.45.1` | Type-safe, compatível Neon, migrations simples |
| **Auth** | Clerk (`@clerk/nextjs`) | `6.38.2` | Multi-tenant nativo, organizations, RBAC |
| **Deploy** | Vercel | — | CI/CD automático, Edge Network, integração Neon |
| **LLM / AI** | Vercel AI SDK | `6.0.99` | `ToolLoopAgent`, streaming, tool calling, AI Gateway |
| **Provedor AI** | `@ai-sdk/openai` | latest | OpenAI GPT-4o via Vercel AI Gateway |
| **Web Scraping** | Crawlee + Playwright | latest | Extração de anúncios das imobiliárias |
| **Job Queue** | Inngest | `3.52.3` | Background jobs com retry, step functions, durable execution |
| **Validação** | Zod | `4.3.6` | Schemas compartilhados client/server, nova API v4 |
| **Estado** | Zustand | `5.0.11` | Estado global de UI leve e tipado |
| **Cache servidor** | TanStack Query | `5.90.21` | Data fetching, cache, invalidation |
| **Email** | Resend | `6.9.2` | Notificações transacionais com templates React |
| **Storage** | Vercel Blob | — | Upload de Excel, cache de resultados |
| **Analytics** | Vercel Analytics + PostHog | — | Uso por tenant, funil de conversão |

---

## 3. Arquitetura Multi-Tenant

### Estratégia: Schema-per-Tenant no Neon

Cada tenant (workspace/organização) recebe um **schema isolado** no mesmo banco Neon. Isso garante:
- Isolamento total de dados
- Queries simples sem `WHERE tenant_id`
- Possibilidade de backups/exports individuais

```
neon-database
├── schema: public          → tabelas compartilhadas (planos, tenants)
├── schema: tenant_abc123   → dados do tenant A
├── schema: tenant_def456   → dados do tenant B
└── schema: tenant_ghi789   → dados do tenant C
```

### Resolução de Tenant

```
buscador.com                  → marketing/landing page
app.buscador.com              → app principal
app.buscador.com/[workspace]  → tenant via path param
```

O middleware do Next.js resolve o tenant pelo subpath ou subdomínio e injeta o `tenant_id` em todo o contexto da request.

### Fluxo de autenticação

```
Usuário acessa app.buscador.com
  → Clerk autentica
  → Clerk Organization = Tenant
  → Middleware extrai orgId (tenant)
  → Drizzle seta search_path para schema do tenant
  → Request processada isoladamente
```

---

## 4. Estrutura de Pastas (Next.js App Router)

```
super-buscador/
├── app/
│   ├── (marketing)/               # Landing page pública
│   │   ├── page.tsx               # Home
│   │   ├── pricing/page.tsx       # Planos e preços
│   │   └── layout.tsx
│   ├── (auth)/                    # Autenticação via Clerk
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   └── sign-up/[[...sign-up]]/page.tsx
│   ├── (app)/                     # App autenticado
│   │   ├── layout.tsx             # Shell com sidebar + header
│   │   ├── dashboard/page.tsx     # Overview do workspace
│   │   ├── buscador/              # ABA 2: Busca de imóveis
│   │   │   ├── page.tsx           # Interface principal de busca
│   │   │   └── [searchId]/page.tsx # Resultado de uma busca salva
│   │   ├── fontes/                # ABA 1: Gestão de URLs/fontes
│   │   │   ├── page.tsx           # Lista de imobiliárias cadastradas
│   │   │   ├── nova/page.tsx      # Adicionar imobiliária manualmente
│   │   │   └── importar/page.tsx  # Import via Excel ou CRECI
│   │   ├── historico/page.tsx     # Histórico de buscas do usuário
│   │   ├── favoritos/page.tsx     # Imóveis salvos/favoritados
│   │   ├── configuracoes/         # Settings do workspace
│   │   │   ├── page.tsx
│   │   │   ├── plano/page.tsx     # Billing e plano
│   │   │   └── membros/page.tsx   # Gestão de usuários do tenant
│   │   └── onboarding/page.tsx    # Fluxo inicial pós-cadastro
│   └── api/
│       ├── webhooks/clerk/route.ts       # Sync Clerk → DB
│       ├── webhooks/inngest/route.ts     # Inngest handler
│       ├── chat/route.ts                 # AI stream (Vercel AI SDK)
│       ├── fontes/route.ts              # CRUD de fontes/URLs
│       ├── fontes/[id]/crawl/route.ts   # Trigger crawl manual
│       ├── imoveis/search/route.ts      # Busca filtrada
│       ├── imoveis/export/route.ts      # Export Excel
│       └── creci/extract/route.ts       # Extração CRECI por cidade
├── components/
│   ├── ui/                        # shadcn components (gerados via CLI)
│   ├── buscador/
│   │   ├── SearchChat.tsx         # Interface de busca por AI chat
│   │   ├── FilterPanel.tsx        # Filtros tradicionais (caixinhas)
│   │   ├── ResultsGrid.tsx        # Grid de imóveis encontrados
│   │   ├── ImovelCard.tsx         # Card individual de imóvel
│   │   └── ExportButton.tsx       # Botão exportar Excel
│   ├── fontes/
│   │   ├── FontesList.tsx         # Lista de imobiliárias
│   │   ├── AddFonteForm.tsx       # Formulário manual
│   │   ├── ExcelImport.tsx        # Drag-and-drop upload Excel
│   │   └── CreiExtractor.tsx      # Busca por cidade no CRECI
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── TenantSwitcher.tsx
│   └── shared/
│       ├── EmptyState.tsx
│       ├── LoadingSpinner.tsx
│       └── UpgradeBanner.tsx
├── lib/
│   ├── db/
│   │   ├── index.ts               # Conexão Neon + Drizzle
│   │   ├── schema/
│   │   │   ├── public.ts          # Schema público (tenants, planos)
│   │   │   └── tenant.ts          # Schema por tenant
│   │   └── migrations/
│   ├── ai/
│   │   ├── tools.ts               # Tool definitions (filtros como tools)
│   │   └── prompts.ts             # System prompts
│   ├── crawler/
│   │   ├── index.ts               # Orchestrator de crawling
│   │   └── parsers/               # Parsers por plataforma (Tecimob, etc.)
│   ├── creci/
│   │   └── extractor.ts           # Scraper do site do CRECI
│   ├── inngest/
│   │   ├── client.ts
│   │   └── functions/
│   │       ├── crawl-fonte.ts     # Job: crawl de uma fonte
│   │       └── sync-imoveis.ts    # Job: sincronização periódica
│   └── utils/
│       ├── tenant.ts              # Helper para resolver tenant
│       └── excel.ts              # Parse/export Excel (xlsx)
├── hooks/
│   ├── useTenant.ts
│   ├── useSearch.ts
│   └── useFontes.ts
├── middleware.ts                  # Resolução de tenant + auth guard
├── drizzle.config.ts
└── .env.local
```

---

## 5. Schema do Banco de Dados

### Schema Público (compartilhado)

```sql
-- Tenants (sincronizado com Clerk Organizations)
CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,           -- clerk org_id
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  plan        TEXT DEFAULT 'free',        -- free | pro | enterprise
  schema_name TEXT UNIQUE NOT NULL,       -- nome do schema isolado
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Planos disponíveis
CREATE TABLE plans (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  price_monthly     INTEGER,              -- em centavos BRL
  max_fontes        INTEGER,
  max_searches_day  INTEGER,
  ai_searches       BOOLEAN DEFAULT FALSE
);
```

### Schema por Tenant

```sql
-- Imobiliárias/fontes de dados
CREATE TABLE fontes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  url         TEXT UNIQUE NOT NULL,
  cidade      TEXT,
  estado      TEXT,
  ativa       BOOLEAN DEFAULT TRUE,
  last_crawl  TIMESTAMPTZ,
  status      TEXT DEFAULT 'pendente',   -- pendente | crawling | ok | erro
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Imóveis extraídos
CREATE TABLE imoveis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id        UUID REFERENCES fontes(id) ON DELETE CASCADE,
  url_anuncio     TEXT NOT NULL,
  titulo          TEXT,
  tipo            TEXT,                  -- apartamento | casa | terreno | comercial
  cidade          TEXT,
  bairro          TEXT,
  estado          TEXT,
  preco           NUMERIC,
  area_m2         NUMERIC,
  quartos         INTEGER,
  banheiros       INTEGER,
  vagas           INTEGER,
  descricao       TEXT,
  imagens         TEXT[],
  caracteristicas JSONB,
  disponivel      BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Histórico de buscas (memória do AI)
CREATE TABLE searches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,             -- clerk user_id
  titulo      TEXT,
  filtros     JSONB,                     -- filtros aplicados
  resultado   JSONB,                     -- snapshot dos resultados
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Mensagens do chat AI por busca
CREATE TABLE chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id   UUID REFERENCES searches(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,             -- user | assistant | tool
  content     TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Imóveis favoritados
CREATE TABLE favoritos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  imovel_id   UUID REFERENCES imoveis(id) ON DELETE CASCADE,
  nota        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, imovel_id)
);
```

---

## 6. Funcionalidades Detalhadas

### 6.1 ABA 1 — Gestão de Fontes (Imobiliárias)

**Adição Manual**
- Formulário com: Nome da imobiliária, URL, Cidade, Estado
- Validação de URL acessível antes de salvar
- Status visual: pendente → crawling → ativo

**Import via Excel**
- Drag-and-drop de arquivo `.xlsx` ou `.csv`
- Template disponível para download
- Colunas: nome, url, cidade, estado
- Preview dos dados antes de confirmar
- Processamento assíncrono via Inngest

**Extração via CRECI**
- Input: nome da cidade
- A plataforma busca automaticamente imobiliárias registradas no CRECI daquela cidade
- IA extrai nome + URL do site de cada imobiliária
- Usuário revisa e aprova quais importar
- Suporte a múltiplas cidades em batch

**Dashboard de Fontes**
- Tabela com todas as imobiliárias cadastradas
- Status de crawling, última atualização, total de imóveis
- Ações: recrawl manual, ativar/desativar, deletar
- Filtros por cidade, estado, status

### 6.2 ABA 2 — Buscador de Imóveis

**Busca por Chat AI (modo principal)**
```
Usuário: "quero um apartamento de 2 quartos em Caxias do Sul, 
          até 500 mil, com garagem"

IA:       "Entendi! Vou buscar:
           • Tipo: Apartamento
           • Quartos: 2+
           • Cidade: Caxias do Sul
           • Preço: até R$ 500.000
           • Garagem: sim
           
           [Confirmar busca] [Ajustar filtros]"
```

**Busca por Filtros (modo clássico)**
- Tipo de imóvel (select)
- Cidade / Bairro (combobox com autocomplete)
- Faixa de preço (range slider)
- Área mínima em m²
- Quartos / Banheiros / Vagas (incremento numérico)
- Características extras (checkbox: piscina, academia, etc.)
- Imobiliárias específicas (multiselect)

**Resultados**
- Grid responsivo de cards com foto, preço, endereço e características
- Ordenação: relevância, preço ↑↓, área ↑↓, mais recente
- Paginação infinita
- Botão "Ver anúncio" → abre URL original da imobiliária
- Botão "Favoritar" → salva o imóvel
- Botão "Exportar Excel" → baixa todos os resultados da busca

**Memória AI**
- Histórico de conversas salvo por usuário
- IA lembra buscas anteriores: *"Olá Mateus! Da última vez você buscava apartamentos em Caxias. Quer continuar?"*
- Usuário pode retomar ou criar nova busca

### 6.3 Histórico e Favoritos

- Lista de buscas anteriores com preview dos filtros
- Reabrir busca com os mesmos filtros
- Coleção de imóveis favoritados com notas pessoais
- Export de favoritos em Excel

### 6.4 Onboarding

1. Criar workspace (nome + slug)
2. Escolher plano
3. Adicionar primeira fonte (manual, Excel ou CRECI)
4. Aguardar primeiro crawl
5. Fazer primeira busca

---

## 7. Integração AI (Vercel AI SDK v6)

### Arquitetura — ToolLoopAgent (novo padrão v6)

O AI SDK v6 introduziu `ToolLoopAgent` como forma nativa de construir agentes com tool calling. A IA usa essa API para interpretar pedidos em linguagem natural e converter em filtros estruturados:

```typescript
// lib/ai/buscador-agent.ts
import * as z from "zod"                        // Zod v4: import * as z
import { ToolLoopAgent, InferAgentUIMessage } from "ai"
import { openai } from "@ai-sdk/openai"
import { searchImoveis } from "@/lib/db/queries"

export const buscadorAgent = new ToolLoopAgent({
  model: openai("gpt-4o"),                       // ou via Vercel AI Gateway: "openai/gpt-4o"
  system: `Você é um assistente especializado em busca imobiliária chamado "Buscador".
Seu objetivo é entender o que o usuário quer e converter em filtros precisos.
Sempre:
1. Confirme seu entendimento antes de buscar
2. Use linguagem natural e amigável
3. Lembre buscas anteriores do usuário quando relevante
4. Sugira ajustes quando os resultados forem poucos
5. Responda em português do Brasil`,
  tools: {
    // IA confirma entendimento antes de executar
    confirmar_filtros: {
      description: "Apresenta os filtros interpretados para aprovação do usuário",
      parameters: z.object({
        resumo: z.string(),
        filtros: z.object({
          tipo: z.enum(["apartamento", "casa", "terreno", "comercial"]).optional(),
          cidade: z.string().optional(),
          bairro: z.string().optional(),
          preco_min: z.number().optional(),
          preco_max: z.number().optional(),
          area_min: z.number().optional(),
          quartos_min: z.number().optional(),
          vagas: z.number().optional(),
        }),
      }),
    },
    // IA executa a busca com os filtros aprovados
    buscar_imoveis: {
      description: "Busca imóveis no banco de dados com os filtros especificados",
      parameters: z.object({
        tipo: z.enum(["apartamento", "casa", "terreno", "comercial"]).optional(),
        cidade: z.string().optional(),
        bairro: z.string().optional(),
        preco_min: z.number().optional(),
        preco_max: z.number().optional(),
        area_min: z.number().optional(),
        quartos_min: z.number().optional(),
        vagas: z.number().optional(),
        caracteristicas: z.array(z.string()).optional(),
      }),
      execute: async (filters, { tenantId }: { tenantId: string }) =>
        searchImoveis(tenantId, filters),
    },
  },
})

export type BuscadorMessage = InferAgentUIMessage<typeof buscadorAgent>
```

### Route Handler (Next.js 16 App Router)

```typescript
// app/api/chat/route.ts
import { buscadorAgent } from "@/lib/ai/buscador-agent"
import { createAgentUIStreamResponse } from "ai"
import { auth } from "@clerk/nextjs/server"
import { getTenantId } from "@/lib/utils/tenant"

export async function POST(req: Request) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return new Response("Unauthorized", { status: 401 })

  const { messages } = await req.json()
  const tenantId = await getTenantId(orgId)

  return createAgentUIStreamResponse({
    agent: buscadorAgent,
    messages,
    context: { tenantId },   // disponível no execute() das tools
  })
}
```

### Componente de Chat (React 19 + `@ai-sdk/react`)

```typescript
// components/buscador/SearchChat.tsx
"use client"
import { useChat } from "@ai-sdk/react"           // separado do pacote ai no v6
import type { BuscadorMessage } from "@/lib/ai/buscador-agent"

export function SearchChat() {
  const { messages, status, sendMessage } = useChat<BuscadorMessage>()
  const [input, setInput] = useState("")

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          {msg.parts.map((part, i) => {
            if (part.type === "text") return <p key={i}>{part.text}</p>
            if (part.type === "tool-buscar_imoveis") {
              return <ResultsGrid key={i} invocation={part} />
            }
          })}
        </div>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); sendMessage({ text: input }); setInput("") }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={status !== "ready"} />
      </form>
    </div>
  )
}
```

---

## 8. Sistema de Crawling

### Fluxo de Crawl

```
Trigger (manual ou agendado)
  → Inngest job: crawl-fonte
    → Playwright abre URL da imobiliária
    → Detecta plataforma (Tecimob, Jetimob, Bume, etc.)
    → Extrai listagem de imóveis (paginação automática)
    → Normaliza dados → schema Imovel
    → Upsert no banco do tenant
    → Atualiza status da fonte
    → Trigger: notify-complete (opcional)
```

### Parsers por Plataforma

A maioria das imobiliárias brasileiras usa plataformas conhecidas. Parsers dedicados:

| Plataforma | Penetração |
|---|---|
| Tecimob | Alta |
| Jetimob | Alta |
| Bume | Média |
| Imoview | Média |
| Generic (LLM-based) | Fallback para sites custom |

### Agendamento

- Crawl inicial: imediato após cadastro da fonte
- Re-crawl automático: a cada 24h para fontes ativas
- Re-crawl manual: disponível no painel de fontes
- Detecção de imóvel removido: marca `disponivel = false`

---

## 9. Export Excel

```typescript
// Usando a biblioteca xlsx
import * as XLSX from 'xlsx'

const exportarImoveis = (imoveis: Imovel[]) => {
  const data = imoveis.map(i => ({
    'Tipo':        i.tipo,
    'Endereço':    `${i.bairro}, ${i.cidade}/${i.estado}`,
    'Preço':       formatarMoeda(i.preco),
    'Área (m²)':  i.area_m2,
    'Quartos':     i.quartos,
    'Vagas':       i.vagas,
    'Imobiliária': i.fonte?.nome,
    'Link':        i.url_anuncio,
  }))
  
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Imóveis')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
```

---

## 10. Planos e Limites

| Feature | Gratuito | Pro (R$99/mês) | Enterprise |
|---|---|---|---|
| Fontes cadastradas | 5 | 50 | Ilimitado |
| Buscas AI/dia | 10 | 100 | Ilimitado |
| Busca por filtros | ✅ | ✅ | ✅ |
| Busca por chat AI | ✅ (limitado) | ✅ | ✅ |
| Memória AI | ❌ | ✅ | ✅ |
| Export Excel | ❌ | ✅ | ✅ |
| Import Excel | ❌ | ✅ | ✅ |
| Extração CRECI | ❌ | ✅ | ✅ |
| Membros no workspace | 1 | 3 | Ilimitado |
| Suporte | Community | Email | Prioritário |

---

## 11. Variáveis de Ambiente

```env
# Banco de dados
DATABASE_URL=postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require

# Autenticação (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# AI
OPENAI_API_KEY=sk-...

# Inngest
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...

# Email
RESEND_API_KEY=re_...

# Storage
BLOB_READ_WRITE_TOKEN=vercel_blob_...

# App
NEXT_PUBLIC_APP_URL=https://app.buscador.com
```

---

## 12. Roadmap de Desenvolvimento

### Fase 1 — MVP (até 11/03) 🎯

- [ ] Setup Next.js 15 + shadcn + Drizzle + Neon
- [ ] Autenticação básica com Clerk (sem multi-org ainda)
- [ ] Schema do banco de dados (schema único inicial)
- [ ] Cadastro manual de fontes (URLs de imobiliárias)
- [ ] Crawler básico com Playwright (1-2 parsers)
- [ ] Busca por filtros tradicionais (caixinhas)
- [ ] Exibição de resultados em cards
- [ ] Deploy na Vercel

**Objetivo: protótipo crudo funcional para apresentar ao Mateus**

### Fase 2 — AI + Multi-tenant (Março/Abril)

- [ ] Multi-tenancy completo (Clerk Organizations + schemas Neon)
- [ ] Chat AI com Vercel AI SDK e tool calling
- [ ] Memória de conversas por usuário
- [ ] Import de fontes via Excel
- [ ] Extração CRECI por cidade
- [ ] Export de resultados para Excel
- [ ] Histórico de buscas e favoritos

### Fase 3 — SaaS Completo (Abril/Maio)

- [ ] Sistema de planos e billing (Stripe)
- [ ] Onboarding flow
- [ ] Dashboard de analytics por tenant
- [ ] Parsers para principais plataformas imobiliárias BR
- [ ] Notificações por email (novos imóveis que combinam com buscas salvas)
- [ ] Landing page + página de preços

### Fase 4 — Escala (Pós-lançamento)

- [ ] App mobile (React Native / Expo)
- [ ] Integração via API para parceiros
- [ ] Alertas de variação de preço
- [ ] Estimativa de valorização (integração com dados públicos)

---

## 13. Comandos Iniciais do Projeto

```bash
# Criar projeto Next.js 16 com React 19 + TypeScript + Tailwind + App Router
npx create-next-app@latest super-buscador --typescript --tailwind --app

# Instalar shadcn/ui (Tailwind v4 detectado automaticamente)
npx shadcn@latest init

# Componentes shadcn necessários
npx shadcn@latest add button card input label select slider checkbox badge
npx shadcn@latest add table dialog sheet sidebar tabs command tooltip
npx shadcn@latest add form toast skeleton separator avatar dropdown-menu

# ORM + Banco de dados
npm install drizzle-orm@0.45.1 @neondatabase/serverless
npm install -D drizzle-kit

# Autenticação multi-tenant
npm install @clerk/nextjs@6.38.2

# AI SDK v6 — pacote principal + providers separados + hooks react
npm install ai@6.0.99 @ai-sdk/openai @ai-sdk/react

# Validação (Zod v4 — nova API: import * as z from "zod")
npm install zod@4.3.6

# Background jobs / durable execution
npm install inngest@3.52.3

# Estado global
npm install zustand@5.0.11

# Data fetching / cache
npm install @tanstack/react-query@5.90.21

# Email transacional
npm install resend@6.9.2

# Processamento de Excel
npm install xlsx

# Web scraping
npm install crawlee playwright

# Dev dependencies
npm install -D typescript@5.9.3 @types/node tsx
```

> **Nota Zod v4:** O import mudou para `import * as z from "zod"` (não mais `import { z } from "zod"`).  
> **Nota AI SDK v6:** `useChat` agora vem de `@ai-sdk/react`, não do pacote `ai` diretamente. `ToolLoopAgent` substitui o padrão manual de tool calling.

---

## 14. Próximos Passos Imediatos

1. **Luis**: Inicializar repositório com estrutura base (Next.js + Neon + Clerk)
2. **Luis**: Implementar crawler básico para 1-2 imobiliárias de teste de Caxias do Sul
3. **Luis**: Montar UI da busca por filtros com dados mockados
4. **Mateus**: Definir nome comercial e domínio do produto
5. **Mateus**: Levantar lista inicial de imobiliárias de Caxias do Sul para testes
6. **Ambos**: Reunião de revisão do protótipo em 11/03

---

*Documento gerado em 25/02/2026 — baseado na reunião entre Luis Fernando Boff e Mateus Rimoldi Facchin*  
*Stack revisada com versões stable verificadas no npmjs.com em 25/02/2026.*
