# Matriz Comparativa de Soluções de Web Scraping

## Escopo

Este documento compara soluções reais de mercado e open source para o problema que vocês têm hoje:

- descobrir páginas de listagem
- navegar paginação corretamente
- extrair URLs de detalhe
- extrair campos de imóvel com menos erro
- reduzir erro silencioso em bairro, metragem, fotos e status
- operar com boa relação entre cobertura, velocidade e custo

Importante:

- esta pesquisa foi direcionada, não exaustiva
- eu não revisei "todos" os repositórios do GitHub nem "todos" os apps do mercado
- eu selecionei as soluções mais relevantes para o teu caso com base em documentação oficial, repositórios oficiais e encaixe arquitetural
- esta matriz é uma análise de arquitetura e produto, não um benchmark hands-on executado em dezenas de sites

Data da revisão: `2026-03-29`

---

## Critérios

Os critérios usados foram estes:

1. Descoberta de páginas e URLs de detalhe
2. Tratamento de paginação, infinite scroll e load more
3. Extração estruturada de detalhe
4. Validação da extração
5. Tratamento de imagens
6. Escalabilidade e operação
7. Custo previsível
8. Controle técnico para corrigir erro fino
9. Aderência ao teu caso de portais imobiliários heterogêneos

Escala usada na matriz:

- `Alta`
- `Média`
- `Baixa`

Para custo:

- `Baixo`
- `Médio`
- `Alto`
- `Variável`

---

## Leitura Rápida

Resposta curta:

- não existe uma solução pronta que elimine por si só os teus problemas de `bairro`, `area_m2`, `fotos` e `paginação`
- as melhores soluções para o teu caso não são as mais "mágicas"; são as que te dão mais controle para separar discovery, extraction, validation e repair
- para o teu cenário, a melhor direção continua sendo um stack híbrido próprio, usando referências fortes de mercado em vez de terceirizar o problema inteiro para uma plataforma no-code ou um agente genérico

Minha leitura objetiva:

- melhor referência arquitetural para discovery e roteamento: `Crawlee`
- melhor base Python adaptativa para extração e template healing: `Scrapling`
- melhor referência de extração "LLM-friendly" e HTML limpo: `Crawl4AI`
- melhor referência de workflow em 2 etapas lista -> detalhe: `Browse AI`
- melhor plataforma pronta para rodar scrapers com escala e scheduling: `Apify`
- melhor opção quando o problema principal for antibot/unlocking: `Bright Data`
- pior escolha como núcleo do teu pipeline: agentes browser genéricos como `Browser Use` rodando tudo no modo agentic

---

## Matriz Comparativa

| Solução | Tipo | Discovery/Paginação | Extração de detalhe | Validação nativa | Imagens | Custo | Velocidade | Controle fino | Fit para teu caso |
|---|---|---|---|---|---|---|---|---|---|
| [Crawlee](https://crawlee.dev/python/docs/guides/request-router) | framework OSS | Alta | Média | Baixa | Baixa | Baixo | Alta | Alta | Alta |
| [Scrapling](https://github.com/D4Vinci/Scrapling) + [adaptive docs](https://scrapling.readthedocs.io/en/v0.3.9/parsing/adaptive/) | lib OSS Python | Média | Alta | Média | Baixa | Baixo | Alta | Alta | Alta |
| [Crawl4AI](https://docs.crawl4ai.com/complete-sdk-reference/) | framework OSS Python | Média | Alta | Média | Baixa | Baixo | Média | Alta | Alta |
| [Apify Web Scraper](https://apify.com/apify/web-scraper) | plataforma + actor | Alta | Média | Baixa | Baixa | Variável | Alta | Média | Alta |
| [Browse AI](https://help.browse.ai/en/articles/10459476-workflows-how-can-i-create-a-workflow-connecting-two-robots) | app no-code | Média | Média | Baixa | Baixa | Médio/Alto | Média | Baixa | Média |
| [Firecrawl](https://docs.firecrawl.dev/billing) + [Extract](https://docs.firecrawl.dev/features/extract) + [Browser](https://docs.firecrawl.dev/features/browser) | API SaaS | Média | Média/Alta | Baixa | Baixa | Variável | Alta | Média | Média |
| [Bright Data Web Unlocker / Web Scraper / Datasets](https://docs.brightdata.com/scraping-automation/web-unlocker/features) | infra + APIs + datasets | Média | Média | Baixa | Baixa | Alto | Alta | Média | Alta |
| [Browser Use](https://docs.browser-use.com/cloud/pricing) | browser agent | Baixa/Média | Média | Baixa | Baixa | Variável/Alto | Baixa/Média | Média | Baixa |
| [Octoparse](https://www.octoparse.com/pricing) | app no-code | Média | Média | Baixa | Baixa | Médio | Média | Baixa | Média |
| [ParseHub](https://help.parsehub.com/hc/en-us/articles/360006322493-Pricing-of-Paid-Plans) | app no-code | Média | Média | Baixa | Baixa | Médio/Alto | Média | Baixa | Média/Baixa |

---

## O Que Cada Solução Faz Bem ou Mal

## 1. Crawlee

### Pontos fortes

- router por labels é excelente para organizar `HOME`, `LISTING`, `PAGINATION`, `DETAIL`, `API`
- bom modelo mental para separar responsabilidades
- forte para crawling e paginação
- ótimo para fila, retries e organização do fluxo

### Limites

- não resolve sozinho a qualidade da extração
- não resolve sozinho bairro/metragem errados
- não resolve validação final nem fotos corretas

### Leitura para o teu caso

É a melhor referência de arquitetura de crawl da lista. Mesmo que vocês continuem em Python, o padrão de `Router` e request labels é um dos acertos mais reaproveitáveis.

Fonte:

- [Crawlee request router](https://crawlee.dev/python/docs/guides/request-router)

---

## 2. Scrapling

### Pontos fortes

- excelente encaixe com o que vocês já têm
- fetch adaptativo
- suporte a sessão e stealth
- recurso `adaptive` combina muito com a ideia de aprendizado por domínio
- performance boa para quem quer controle fino em Python

### Limites

- não traz, por padrão, uma camada formal de validação de negócio
- não resolve sozinho workflow de discovery em múltiplas etapas
- não resolve sozinho a seleção correta de fotos

### Leitura para o teu caso

É provavelmente a melhor base para continuar a parte de extração, template learning e healing, desde que vocês adicionem uma camada explícita de validator e repair.

Fontes:

- [Scrapling GitHub](https://github.com/D4Vinci/Scrapling)
- [Adaptive scraping docs](https://scrapling.readthedocs.io/en/v0.3.9/parsing/adaptive/)

---

## 3. Crawl4AI

### Pontos fortes

- pensado para gerar HTML limpo, markdown e extração estruturada
- documentação forte para conteúdo limpo e schema extraction
- boa referência para pipelines LLM-friendly sem precisar mandar HTML bruto sempre

### Limites

- mais forte em limpeza e structured extraction do que em crawling operacional pesado
- não substitui sozinho uma estratégia robusta de paginação e stateful discovery

### Leitura para o teu caso

É uma boa referência para o teu extrator/validator, especialmente para reduzir ruído e melhorar o input de extração. Não seria minha escolha como núcleo único do pipeline inteiro.

Fonte:

- [Crawl4AI complete SDK reference](https://docs.crawl4ai.com/complete-sdk-reference/)

---

## 4. Apify

### Pontos fortes

- excelente para operação em escala
- actor store, scheduling, datasets, API, webhooks
- genérico o bastante para real estate
- consegue rodar descoberta e crawling completo

### Limites

- a qualidade da extração ainda depende muito do actor ou do código que tu escrever
- não resolve sozinho validação semântica por campo
- plataforma pode facilitar operação, mas não desenha o teu validador por ti

### Leitura para o teu caso

Se vocês quisessem terceirizar parte da operação e fila, Apify é um candidato forte. Como referência arquitetural, é muito bom. Como cura automática para erro de bairro/m²/fotos, não.

Fontes:

- [Apify Web Scraper](https://apify.com/apify/web-scraper)
- [Apify pricing](https://apify.com/pricing/)

---

## 5. Browse AI

### Pontos fortes

- a ideia de dois robôs conectados para lista -> detalhe é muito boa
- ótimo para mostrar visualmente o conceito de deep scraping
- bom para times não técnicos ou operações semi-gerenciadas

### Limites

- menos controle fino
- custo cresce rápido conforme páginas e créditos
- validação de qualidade continua sendo tua responsabilidade
- menos confortável para lógica sofisticada de repair e degraded mode

### Leitura para o teu caso

Browse AI é uma ótima referência conceitual para o fluxo em 2 etapas. Eu usaria como referência de produto, não como núcleo do teu pipeline principal.

Fontes:

- [Workflows: connect two robots](https://help.browse.ai/en/articles/10459476-workflows-how-can-i-create-a-workflow-connecting-two-robots)
- [Browse AI pricing](https://www.browse.ai/pricing)
- [Building your first robot](https://help.browse.ai/en/articles/12591043-building-your-first-robot)

---

## 6. Firecrawl

### Pontos fortes

- API simples
- custo por página relativamente claro
- converte URL para markdown/HTML/structured data rápido
- browser integrado pode ser útil em hard cases

### Limites

- muito bom para scrape/extract, mas não é a melhor fundação para teu discovery sofisticado por domínio
- ainda vais precisar modelar regras de validação e imagens
- se virar fallback para muita página, custo sobe

### Leitura para o teu caso

Vejo mais como ferramenta complementar ou fallback, não como stack principal para esse caso de real estate com muita paginação e validação específica.

Fontes:

- [Firecrawl billing](https://docs.firecrawl.dev/billing)
- [Firecrawl extract](https://docs.firecrawl.dev/features/extract)
- [Firecrawl browser](https://docs.firecrawl.dev/features/browser)
- [Firecrawl pricing](https://www.firecrawl.dev/pricing)

---

## 7. Bright Data

### Pontos fortes

- resolve bem o problema de antibot, proxy, unlocking e datasets prontos
- tem dataset de real estate já estruturado
- forte quando o gargalo principal é acesso e bloqueio, não parsing

### Limites

- custo tende a ser alto
- resolve acesso, mas não substitui o teu validador de qualidade
- pode ser ótimo para hard domains, mas excessivo como caminho padrão para tudo

### Leitura para o teu caso

Eu usaria Bright Data como:

- fallback para domínios difíceis
- opção de dataset pronto onde fizer sentido comercialmente
- não como default operacional para todos os sites

Fontes:

- [Web Unlocker features](https://docs.brightdata.com/scraping-automation/web-unlocker/features)
- [Web Scraper API pricing](https://brightdata.com/pricing/web-scraper)
- [Real estate datasets](https://brightdata.com/products/datasets/real-estate)
- [Dataset marketplace overview](https://docs.brightdata.com/dataset-marketplace-quickstart)

---

## 8. Browser Use

### Pontos fortes

- muito bom para automação agentic e tarefas browser-first
- útil para hard interactions, formulários, navegação complexa e exploração assistida
- skills e cloud sessions são interessantes

### Limites

- como núcleo de scraping em massa, tende a ser mais frágil e caro
- agentic step-by-step não é o melhor modelo para extração repetitiva em larga escala
- paginação e consistência de cobertura podem ficar piores do que num crawler desenhado para isso

### Leitura para o teu caso

Eu não usaria Browser Use como pipeline principal de scraping imobiliário em escala. No máximo:

- ferramenta de exploração/debug
- fallback raro em sites extremamente interativos

Fontes:

- [Browser Use pricing](https://docs.browser-use.com/cloud/pricing)
- [Browser sessions](https://docs.cloud.browser-use.com/concepts/browser)
- [Browser Use Cloud overview](https://docs.browser-use.com/)

---

## 9. Octoparse

### Pontos fortes

- no-code
- lida com AJAX, JS, login, paginação e infinite scroll
- bom para times menos técnicos

### Limites

- menos controle fino
- paginação browser-based pode ficar lenta e custosa
- validação semântica e repair continuam fora do produto
- difícil transformar isso num sistema realmente confiável para casos muito heterogêneos

### Leitura para o teu caso

Serve melhor como ferramenta operacional pontual ou para casos menos complexos. Não é a melhor base para o teu nível de customização e validação.

Fontes:

- [Octoparse pricing](https://www.octoparse.com/pricing)
- [What types of websites/data can Octoparse scrape?](https://helpcenter.octoparse.com/en/articles/6807162-what-types-of-websites-data-can-octoparse-scrape)
- [Dealing with pagination (infinite scroll)](https://helpcenter.octoparse.com/en/articles/6470993-dealing-with-pagination-infinite-scroll)

---

## 10. ParseHub

### Pontos fortes

- modelo tradicional de visual scraper
- scheduling e IP rotation nas camadas pagas
- razoável para automações menos customizadas

### Limites

- pricing e page-count podem ficar pesados
- cada scroll/click/load conta como page event em muitos cenários
- menos adequado para lógica fina de validator, template healing e confidence scoring

### Leitura para o teu caso

Eu colocaria abaixo de Octoparse e bem abaixo de uma stack própria híbrida.

Fontes:

- [ParseHub pricing help article](https://help.parsehub.com/hc/en-us/articles/360006322493-Pricing-of-Paid-Plans)
- [ParseHub pricing](https://www.parsehub.com/pricing)

---

## O Que Nenhuma Ferramenta Resolve Sozinha

Esse ponto é o mais importante da comparação.

Nenhuma dessas soluções resolve sozinha, de forma confiável:

- `bairro` semanticamente correto
- `area_m2` distinguida de `vagas/quartos`
- galeria de fotos correta sem banner/logo/planta/mapa
- paginação completa em qualquer portal heterogêneo
- repair automático de template ruim com confiança rastreável

Para isso, tu ainda precisas de uma camada tua de:

- `validator`
- `confidence scoring`
- `cross-source checks`
- `template conflict handling`
- `image validation`

Ou seja: o diferencial competitivo do teu sistema não é "usar scraping". É como tu valida, repara e decide persistir ou não o dado.

---

## Recomendação Objetiva Para o Teu Caso

## Stack recomendada

### Núcleo

- `Scrapling` como base Python de fetch/extraction/template
- padrão de `Router` do `Crawlee` como inspiração para organizar discovery
- `site_profile` persistido por domínio
- `validator` explícito por campo antes do upsert

### Complementos

- `Crawl4AI` como referência para limpeza/structured extraction quando útil
- `Apify` como referência operacional ou eventual backend de runs/schedule, se quiserem terceirizar parte da infraestrutura
- `Bright Data` apenas para domínios difíceis ou acesso problemático
- `Browser Use` apenas como ferramenta de exploração/debug, não como core engine

### Ideia central

O melhor desenho não é:

- um agente browser genérico fazendo tudo

Nem é:

- um produto no-code tentando cobrir todos os domínios

O melhor desenho para vocês é:

- discovery roteado
- extraction híbrida
- validator determinístico
- repair seletivo por LLM
- template com estado e quarentena

---

## Prioridade de Implementação

Se eu tivesse que transformar essa matriz em trabalho prático, eu faria nesta ordem:

1. separar `planner`, `extractor`, `validator`, `repair`
2. adicionar `source`, `confidence` e `validation_reasons` por campo
3. criar `image validator`
4. reorganizar discovery em labels estilo router
5. só depois discutir se vale integrar mais alguma plataforma externa

Isso porque teu maior problema hoje não é falta de ferramenta. É falta de contrato explícito de qualidade entre extração e persistência.

---

## Conclusão

Minha conclusão continua a mesma, agora com comparação mais ampla:

- a tua melhor saída não é trocar tudo por um app
- a tua melhor saída também não é entregar tudo para um agente browser genérico
- a melhor saída é uma arquitetura própria híbrida, usando ideias de mercado bem escolhidas

Se a pergunta for "essa proposta elimina os erros?", a resposta segue sendo não.

Se a pergunta for "essa proposta reduz fortemente os erros e faz eles pararem de ser silenciosos?", a resposta é sim. E isso, na prática, é o que mais importa para transformar o pipeline em algo confiável.

---

## Referências

- [Crawlee request router](https://crawlee.dev/python/docs/guides/request-router)
- [Scrapling GitHub](https://github.com/D4Vinci/Scrapling)
- [Scrapling adaptive scraping docs](https://scrapling.readthedocs.io/en/v0.3.9/parsing/adaptive/)
- [Crawl4AI SDK reference](https://docs.crawl4ai.com/complete-sdk-reference/)
- [Apify Web Scraper](https://apify.com/apify/web-scraper)
- [Apify pricing](https://apify.com/pricing/)
- [Browse AI workflows](https://help.browse.ai/en/articles/10459476-workflows-how-can-i-create-a-workflow-connecting-two-robots)
- [Browse AI pricing](https://www.browse.ai/pricing)
- [Firecrawl billing](https://docs.firecrawl.dev/billing)
- [Firecrawl browser](https://docs.firecrawl.dev/features/browser)
- [Firecrawl extract](https://docs.firecrawl.dev/features/extract)
- [Bright Data Web Unlocker features](https://docs.brightdata.com/scraping-automation/web-unlocker/features)
- [Bright Data Web Scraper pricing](https://brightdata.com/pricing/web-scraper)
- [Bright Data real estate datasets](https://brightdata.com/products/datasets/real-estate)
- [Browser Use pricing](https://docs.browser-use.com/cloud/pricing)
- [Browser Use browser sessions](https://docs.cloud.browser-use.com/concepts/browser)
- [Octoparse pricing](https://www.octoparse.com/pricing)
- [Octoparse supported websites/data](https://helpcenter.octoparse.com/en/articles/6807162-what-types-of-websites-data-can-octoparse-scrape)
- [Octoparse pagination / infinite scroll](https://helpcenter.octoparse.com/en/articles/6470993-dealing-with-pagination-infinite-scroll)
- [ParseHub pricing help article](https://help.parsehub.com/hc/en-us/articles/360006322493-Pricing-of-Paid-Plans)
