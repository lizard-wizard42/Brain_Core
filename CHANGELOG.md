# Changelog

## 2026-10-04 — Busca unificada

- Busca por título e conteúdo de páginas e notas rápidas, com filtros, trechos destacados, caminhos e paginação.
- Resultados respeitam a conta e a lixeira; consultas antigas não substituem a busca atual. Notas rápidas abrem com foco no cartão correspondente.

## 2026-10-04 — Conexão MCP persistente

- Configurações guiam o cadastro por STDIO no Codex/desktop, geram TOML ou JSON e distinguem o caminho remoto do ChatGPT via túnel privado.
- O MCP fornece instruções de edição no handshake; uma skill opcional reutiliza o fluxo de pesquisa, revisões e preservação dos documentos.
- Documentação explica descoberta nas próximas conversas, renovação de credenciais e dependências do acesso remoto, sem apresentar um guia como conexão já ativa.

## 2026-10-04 — Busca de referências no editor

- O seletor `@` explica quando não há resultados ou páginas disponíveis; Escape fecha também nesses estados.
- Busca ignora diferenças de acentos e espaços externos, e resultados mostram a página pai para distinguir títulos iguais.
- O menu permanece dentro da tela, usa as cores do tema e indica quando há mais de oito resultados.
- Enter e setas preservam o comportamento do editor quando não há resultados; composição de texto e atalhos com modificadores não são interceptados.

## 2026-10-04 — Ações de páginas e estados do painel

- Remover uma referência retira apenas o bloco do editor; mover uma subpágina para a lixeira exige confirmação e permite restauração posterior.
- Falhas ao renomear ou excluir preservam o bloco e permitem tentar novamente. Ações ficam disponíveis por teclado e toque.
- O painel distingue carregamento, erro e listas vazias, com nova tentativa independente para páginas e gravações.
- Estados de transcrição aparecem em texto, inclusive quando há erro ou uma transcrição parcial.
- “Continue daqui” abre a página mais recente e recebe destaque; os componentes alterados usam as cores semânticas dos temas.
- Validação usa apenas dados fictícios. Não há alteração de esquema, configuração ou formato de armazenamento.

## 2026-10-03 — Correção da identificação de voz / Android 1.1.1

- A referência de “Minha voz” alimenta sugestões da própria conta, sem atribuição automática. O titular pode ser confirmado antes do primeiro template manual.
- Trechos curtos, sobrepostos, sem áudio disponível ou sem referências deixam de acionar inferência desnecessária.
- Clientes serializam consultas; erros temporários das sugestões preservam decisões e correção manual. O usuário pode atualizar as sugestões.
- Android permite criar o primeiro participante e extrair uma referência após confirmação/correção; a decisão é preservada se o trecho não puder criar referência.
- Regressões usam apenas áudio sintético, incluindo isolamento entre contas e troca/exclusão da referência durante inferência.

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
