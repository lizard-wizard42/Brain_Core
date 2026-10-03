# Changelog

## 2026-10-03 — MCP local e revisão de manutenção

### Funcionalidades

- MCP stdio para consultar, criar, editar, consultar versões e restaurar páginas de notas e notas rápidas da conta.
- Configurações por conta: ligar/desligar MCP, permissões separadas por coleção, validade de 1/7/30/90 dias, revogar uma ou todas as credenciais e consultar as últimas 30 escritas.
- Edições MCP usam revisões, histórico e repetição idempotente. Segredos aparecem uma única vez e são usados por arquivo privado no cliente.
- Memory possui políticas de transcrição automática, agendada ou manual, pausa e retenção de áudio por conta. Participantes são confirmados manualmente; sugestões não atribuem identidade automaticamente.

### Correções e operação

- Cadastro de voz: até 25 MiB e 60 segundos, trabalho fora do event loop e somente um cadastro simultâneo por processo. Amostras a partir de sessão compartilham o mesmo orçamento e aceitam até 128 chunks.
- Finalização de sessão confere o proprietário também na escrita atômica.
- Sessões Socket.IO são revalidadas; logout, mudanças de autenticação e expiração retiram sua autoridade.
- Imagens, anexos, capas e emojis compartilham limites de armazenamento e de uploads por conta.
- Edição compartilhada preserva a autorização dos anexos privados.
- Lembretes Telegram distribuem o lote entre contas e limitam o tempo de cada envio.
- TOTP respeita o bloqueio da conta; tentativas concorrentes são serializadas.
- Templates/sugestões de participantes limitam decodificação e inferência; inferência não bloqueia a escrita SQLite.
- A captura de amostra é cancelada ao sair da tela; clientes atuais vinculam o envio à conta que iniciou a operação. Clientes Android antigos continuam compatíveis, com seu controle anterior de conta.
- Worker CPU segue a política de transcrição da conta e reivindica jobs atomicamente.
- Autosave do canvas ao sair usa revisão e confirmação de sucesso; erros preservam a alteração pendente.
- Histórico de páginas aplica `PAGE_VERSION_RETENTION` também nos salvamentos atuais.
- Backup usa os diretórios efetivos de uploads e Memory; guias distinguem caminhos nativos e Docker.
- Documentação atualizada para uma origem canônica pública, múltiplas contas e serviços opcionais.

### Limites

MCP remoto continua para uma etapa futura. Não há ferramentas MCP de download de arquivos, áudio, transcrições ou terminal. O cliente de IA recebe o conteúdo das notas que consultar e pode usar um provedor remoto. O servidor não oferece criptografia geral de conteúdo em repouso. Não houve publicação de APK nem testes de captura real. A validação desta revisão usa builds e testes automatizados com dados fictícios.
