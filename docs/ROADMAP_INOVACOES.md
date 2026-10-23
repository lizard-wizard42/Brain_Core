# Documento de Arquitetura & Roadmap de Inovação: Brain Core

Este documento detalha o planejamento técnico das 4 principais inovações mapeadas nos líderes open-source de gestão de conhecimento (Docmost, Khoj, Memos, Logseq/Obsidian), com foco de execução prioritário no **Módulo 1: RAG & Busca Semântica Local**.

---

## 1. RAG & Busca Semântica Local (Inspirado em Khoj & Blinko) — *Prioridade 1*

### Objetivo
Permitir que o usuário busque e converse com suas notas, páginas e transcrições de áudio por **significado e contexto semântico**, e não apenas por correspondência literal de caracteres (`ILIKE`).

### Arquitetura Proposta

```
                      [Usuário / Input de Busca / Chat IA]
                                      │
                                      ▼
                        [Backend Express / API Route]
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
     (A) Busca Textual (ILIKE)             (B) Embeddings Locais
       - Correspondência exata               - Provider: Ollama (nomic-embed-text / bge-m3)
       - Rápida p/ títulos                     ou @xenova/transformers local (CPU/GPU)
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
                           [PostgreSQL + pgvector]
                             Tabela: `embeddings`
                       - item_id (uuid / text)
                       - item_kind ('page' | 'note' | 'transcript')
                       - chunk_index (int)
                       - chunk_text (text)
                       - embedding (vector)
                                      │
                                      ▼
                         [Cosine Similarity Search]
                       ORDER BY embedding <=> query_vector
                                      │
                                      ▼
                      [Resultados Híbridos / RAG Context]
```

### Componentes Técnicos
1. **Modelos de Embeddings (100% Offline e Privados):**
   - **Opção Principal (Ollama):** Uso do modelo `nomic-embed-text` ou `bge-m3` via endpoint Ollama já instalado na máquina (`http://127.0.0.1:11434/api/embeddings`).
   - **Opção Alternativa (Node.js nativo):** `@xenova/transformers` com `all-MiniLM-L6-v2` executando em CPU no próprio processo Node ou Python Memory service.
2. **Armazenamento de Vetores:**
   - Criação da tabela de chunks e embeddings no banco de dados com índice vetorial `HNSW` ou `IVFFlat` para busca de similaridade por cosseno (`vector_cosine_ops`).
   - Fallback gracioso: quando pgvector não estiver ativo no PostgreSQL, o sistema usa a busca híbrida textual atual do `noteSearch.ts` com ranking semântico em cache.
3. **Pipeline de Indexação em Background:**
   - Ao salvar/editar uma página (`savePage`) ou nota (`remember_notes`), disparar um job assíncrono para fatiar o texto em chunks (300-500 tokens com overlap de 50) e gerar os embeddings correspondentes.
4. **Interface (Frontend):**
   - Na barra de busca unificada (`UnifiedSearchResults`), adicionar filtro e indicador de modo semântico ("🧠 Busca por Significado / IA").
   - Novo painel ou modal de "Pergunte ao Brain Core" que sintetiza respostas citando as páginas e notas de origem com links diretos.

---

## 2. Visualização em Grafo de Conhecimento (Network Graph) (Inspirado em Logseq & Obsidian)

### Objetivo
Visualizar a rede de interconexões entre páginas, subpáginas, referências embutidas e tags em um grafo 2D interativo com física de nós.

### Arquitetura Proposta
- **Endpoint Backend:** `GET /api/graph` retornando `{ nodes: [{ id, title, type, group, val }], links: [{ source, target, type }] }`.
  - Construído a partir das referências cruzadas (`subPageBlock`, links tiptap `@`, tags e hierarquia pai/filho).
- **Biblioteca Frontend:** `react-force-graph-2d` (baseada em Canvas/WebGL, ultraleve e responsiva).
- **Funcionalidades:**
  - Nós coloridos por status/tipo (Notas, Infinite, Notebook, Seção).
  - Zoom, pan, clique no nó para navegar até a página.
  - Filtro por tags ou profundidade a partir da página ativa atual (Grafo Local vs. Grafo Global).

---

## 3. Visualização Kanban / Board para Subpáginas e Projetos (Inspirado em Docmost & Notion)

### Objetivo
Permitir que qualquer pasta ou página pai seja visualizada como um quadro **Kanban de Tarefas/Projetos**, além da exibição em árvore.

### Arquitetura Proposta
- **Estrutura de Dados:**
  - As páginas do Brain Core já possuem os campos `status` (`todo`, `in_progress`, `done`, `archived`) e `due_date`.
- **Frontend View Switcher:**
  - Na barra de título de uma página com subpáginas, oferecer toggle: `[ 📄 Documento | 📋 Quadro Kanban | 📊 Lista ]`.
  - O quadro Kanban agrupa as subpáginas em colunas pelo campo `status`.
  - Drag-and-drop entre colunas disparando `PATCH /api/pages/:id` com o novo `status`.

---

## 4. Heatmap de Atividade & Daily Log Rápido (Inspirado em Memos)

### Objetivo
Trazer um painel visual de consistência e produtividade ao Dashboard e captura de pensamentos instantânea.

### Arquitetura Proposta
- **Componente Heatmap (Dashboard):**
  - Grid anual/mensal estilo GitHub Contributions (verde/gradiente do tema ativo) contabilizando: páginas criadas/editadas + notas rápidas + gravações transcritas por dia.
- **Micro-captura em 1 Clique:**
  - Input fixo no topo do Dashboard e atalho global (`Ctrl + Shift + N`) para soltar uma ideia rápida sem precisar abrir o menu lateral ou navegar na árvore.
