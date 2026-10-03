# Banco de dados: modelo e operação

## Esquema PostgreSQL

`backend/schema.sql` é a linha de base. Ao iniciar, `ensureAppSchema()`, `ensureAccountOwnership()` e `ensureAgentSchema()` aplicam DDL aditivo e idempotente. `backend/migrations/` contém referências revisadas; não é uma fila para um executor genérico. O par `004-telegram-reminder-fairness.sql` e `.down.sql` documenta a coluna de distribuição de lembretes.

| Grupo | Estado persistido |
| --- | --- |
| `users`, `trusted_devices` | Perfil, proprietário/membro, hash de senha, versão de sessão, TOTP, bloqueio de login e dispositivos confiáveis. A tentativa mais recente de lembrete Telegram permite distribuir a fila entre contas mesmo quando um destino falha. |
| `pages`, `page_versions`, `page_grants` | Hierarquia, conteúdo, revisão, histórico, lixeira e permissões por destinatário. |
| `remember_notes`, `remember_note_versions` | Notas rápidas e histórico de título/corpo; triggers fazem todas as escritas participar das revisões. |
| `contacts`, `uploaded_assets`, `custom_emojis` | Contatos e propriedade dos arquivos enviados. |
| `mobile_devices`, `mobile_sessions`, `browser_recording_sessions` | Vínculo de dispositivo, propriedade de gravações e recibos de sincronização. |
| `integration_settings`, `integration_tokens` | MCP ligado/desligado por conta; hash do token, escopos, versão de sessão, expiração e revogação. |
| `integration_operations`, `integration_audit` | Repetição idempotente ligada ao hash da entrada; auditoria de escritas sem o conteúdo da nota. O resultado idempotente pode conter conteúdo e permanece no banco privado. |

## Consistência e históricos

Salvamentos de páginas por REST, Socket.IO e MCP usam o mesmo controle de revisão e lock. Uma edição baseada em revisão antiga recebe 409; não sobrescreve o conteúdo atual. O editor de página compartilhada não pode acrescentar uma referência que lhe conceda acesso a um arquivo privado que ainda não podia ler.

`PAGE_VERSION_RETENTION` mantém as últimas versões de cada página (100 por padrão, entre 1 e 1000), incluindo versões feitas por MCP. Não é uma política por idade nem uma garantia de preservar versões manuais para sempre. Notas rápidas mantêm histórico de título/corpo; não há retenção automática equivalente nesse histórico. A lista MCP de versões é paginada/limitada conforme o contrato da ferramenta.

Restauração MCP exige a revisão atual e cria outra revisão. Recupera título e conteúdo/corpo, preservando checklist, etiquetas e lembretes omitidos. A rota antiga de restauração web retorna 405; o painel web permite consultar versões, mas não oferece restauração por essa rota.

`operation_id` e hash da entrada tornam retries MCP idempotentes. Um mesmo ID com entrada diferente gera conflito. Desligamento/revogação são rechecados dentro da transação, inclusive em leituras e replays. Jobs CPU/GPU são reivindicados atomicamente, e chunks são confirmados por hash.

## Memory: SQLite separado

O índice fica em `CELTWO_MEMORY_DB_PATH` ou em `CELTWO_MEMORY_DATA_DIR/memory.db`. Guarda sessões e donos, chunks, segmentos, fila de jobs/relabel, políticas por conta, referências de voz, identidades, decisões manuais e templates. Áudio permanece no diretório de dados; não é armazenado como conteúdo de nota PostgreSQL.

O token Memory é de serviço, não uma identidade de usuário. API e workers são confiáveis; chamadas da aplicação precisam carregar o proprietário derivado da autenticação. Cadastro de voz e identificação de participantes têm limites de decodificação e concorrência. Inferência de template acontece fora do lock de escrita; o estado manual e a fonte são conferidos novamente antes da persistência.

Consulte [backup e restauração](BACKUP_BRAIN_CORE.md). O dump inclui credenciais de contas e hashes de integração: mantenha-o privado. Backlinks ainda usam busca textual nas páginas permitidas; não existe uma tabela materializada `page_links`.
