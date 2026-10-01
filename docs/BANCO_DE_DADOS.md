# Banco de dados: modelo e operação

## Como o esquema é gerenciado
1. `backend/schema.sql` é a **linha de base** de um banco novo.
2. `ensureAppSchema()` e `ensureAccountOwnership()` rodam a cada início do backend e aplicam DDL **aditivo e idempotente** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`). Essa é a fonte de verdade para todo o resto.
3. `backend/migrations/` guarda SQL revisado para referência e reversão. `001-personal-workspaces.sql` é um rascunho histórico e **não deve ser aplicado** em um banco em uso; 002 e 003 já são cobertas pelo passo 2. Não crie um executor genérico que aplique todos os arquivos do diretório.

Regra para mudanças de esquema: adicione-as em `ensureAppSchema()` como instruções aditivas e idempotentes e, para revisão, um par `NNN-nome.sql` + `.down.sql`.

## Histórico de versões
`page_versions` cresce a cada salvamento automático. A variável `PAGE_VERSION_RETENTION` (padrão 100) limita o histórico por página. Política recomendada para quem quiser algo mais fino: manter tudo por 14 dias, depois uma versão automática por página por hora até 90 dias e, depois, uma por dia. Nunca apagar versões deliberadas (`create`, `manual`, `restore`, `before: ...`, `ia`, `repair-*`) nem a mais recente da página. Como isso apaga histórico, faça um `pg_dump` antes e rode um `SELECT count(*)` com o mesmo critério para conferir o efeito.

## Backlinks
`getReferences` filtra por `content::text LIKE '%<id>%'` nas páginas do dono. É suficiente em bases pequenas; se as páginas crescerem em ordem de grandeza, guarde as referências de saída em uma tabela `page_links(from_id, to_id)` mantida no salvamento.

## Consistência
- Salvamentos de página usam concorrência otimista (`revision`, HTTP 409 em conflito), igual em REST e Socket.IO, para que editores simultâneos não percam alterações em silêncio.
- Colunas `BIGINT` (como `revision`) são convertidas para número no driver, mantendo o contrato `revision: number`.
- Envio de blocos de áudio é confirmado por hash de conteúdo, então tentativas repetidas são idempotentes.
