# Plano de abertura do Brain Core

> Documento mestre da preparação do Brain Core para publicação como projeto local-first e self-hosted.

## Objetivo

Publicar uma edição instalável do Brain Core sem incluir dados, credenciais ou particularidades da instalação pessoal. Cada pessoa deverá executar sua própria instância e manter banco de dados, páginas, uploads, memórias e segredos sob seu próprio controle.

## Regras de segurança do trabalho

- A instalação privada atual deve continuar funcionando durante a preparação.
- Nenhum arquivo pessoal será apagado ou movido sem backup e autorização explícita.
- Nenhum repositório será tornado público antes da revisão final.
- Segredos nunca serão copiados para documentação, exemplos, logs ou commits.
- Dados de demonstração serão inteiramente fictícios.
- O terminal e outras capacidades de execução privilegiada ficarão desativados por padrão.
- A publicação só será liberada depois de uma verificação do conteúdo rastreado e do histórico Git.

## Estado geral

| Etapa | Estado | Critério de conclusão |
| --- | --- | --- |
| 0. Documento mestre e inventário | Concluída | Plano criado e inventário inicial registrado |
| 1. Auditoria do repositório | Concluída | Estado rastreado e histórico preparado revisados; dependências de produção sem vulnerabilidades |
| 2. Separação público/privado | Em andamento | Instância pessoal fora do artefato público e caminho de migração definido |
| 3. Configuração por `.env` | Em andamento | Exemplos seguros criados e particularidades locais removidas; falta validação central completa |
| 4. Persistência local do usuário | Em andamento | Banco e uploads em volumes locais; memória externa continua opcional/desligada |
| 5. Recursos sensíveis seguros | Em andamento | Terminal desativado por padrão e habilitação explícita documentada |
| 6. Instalação com Docker | Concluída | Instalação limpa e atualização com volumes persistentes validadas |
| 7. Dados fictícios | Concluída | Seed opcional, útil e repetível, sem credenciais ou conteúdo real |
| 8. Apresentação e documentação | Em andamento | README, arquitetura, guias, contribuição e licença MIT criados; imagens pendentes |
| 9. Revisão final de segurança | Em andamento | Dependências, histórico e revisão manual concluídos; pendem backup/restauração e destino público novo |

## Auditoria inicial — 2026-09-21

### Escopo

- Repositório: `<repo>/brain-core`
- Revisão do estado atual do repositório, sem consultar outras revisões do Git.
- Auditoria de leitura; a única alteração inicial é este documento.
- Varredura concluída sob o identificador `c5ce6c14-7fca-4ae7-810e-ccab51002341`.
- O relatório técnico integral permanece como artefato privado da auditoria, pois pode conter excertos automáticos de arquivos pessoais. Somente o resumo sanitizado deste documento pode seguir para uma edição pública.

### Estrutura encontrada

- Backend TypeScript/Express com PostgreSQL, autenticação, uploads, IA, Remember/integração de gravação Android, Socket.IO e terminal baseado em `node-pty`/`tmux`.
- Frontend React/Vite com editor, quadro infinito, anexos, Remember e terminal.
- Scripts operacionais, unidades systemd, rotina de backup e múltiplos artefatos de build.
- Diretórios privados locais para páginas, uploads e backups.

### Bloqueadores já confirmados para um repositório público

1. **Dump real do PostgreSQL está rastreado pelo Git.**
   - Arquivo: `backups/<dump-privado>.sql`
   - Tamanho aproximado: 797 KB.
   - Contém seções de dados para usuários, páginas, versões e emojis.
   - Ação futura: preservar uma cópia privada, remover do repositório público e sanear o histórico antes da publicação.

2. **Uploads reais estão rastreados pelo Git.**
   - Há uma imagem, dois PDFs grandes e um arquivo vazio sob `uploads/`.
   - Os dois PDFs têm aproximadamente 36 MB cada.
   - Ação futura: preservar os originais na instalação privada, retirar os objetos do repositório público e sanear o histórico.

3. **Configuração específica do ambiente está rastreada.**
   - `frontend/.env.local` está versionado e precisa ser substituído por um exemplo neutro.
   - Unidades systemd, scripts e README contêm caminhos, endereços ou pressupostos da máquina atual.

4. **Não existe configuração pública de instalação.**
   - Não foram encontrados `compose.yml`/`docker-compose.yml`, Dockerfiles nem arquivos `.env.example` adequados.

5. **Não existe licença de código aberto.**
   - A licença precisa ser escolhida conscientemente antes da publicação.

6. **O README atual é operacional e particular.**
   - Ele documenta IP, caminhos locais, comandos de serviço e detalhes da infraestrutura pessoal.
   - Será preservado como referência privada ou convertido em documentação de operador; o README público deverá ser neutro.

### Proteções existentes observadas

- `backend/.env` e `frontend/.env` estão ignorados pelo Git.
- O diretório legado de páginas privadas, `uploads/`, `backend/uploads/` e o diretório atual de snapshots de backup estão ignorados localmente ou no repositório, conforme o caso.
- O backend documenta autenticação por cookie, limitação de login, bloqueio de conta, rotação de sessão e TOTP.
- O backend rejeita um segredo JWT fraco ou padrão no início da aplicação.

> Atenção: regras atuais de `.gitignore` não removem arquivos que já foram versionados. Os artefatos privados confirmados acima permanecem no Git até uma limpeza planejada.

### Achados de segurança validados nesta primeira passagem

| Prioridade | Achado | Consequência para a publicação | Tratamento planejado |
| --- | --- | --- | --- |
| Bloqueador crítico | Dump real e uploads privados rastreados pelo Git | Uma publicação exporia conteúdo pessoal e material de autenticação; apagar apenas no próximo commit não limpa o histórico | Interromper qualquer publicação, preservar cópia privada, retirar os artefatos da edição pública, sanear o histórico destinado ao GitHub e trocar material de autenticação afetado |
| Alta | Terminal sempre habilitado | Uma sessão normal do Brain pode abrir um shell com a conta e o ambiente do backend | Criar `TERMINAL_ENABLED=false`, não registrar rotas/eventos quando desligado e isolar o terminal quando habilitado |
| Alta | Uploads sem leitura autenticada e validação insuficiente | Links de arquivos privados podiam ser acessados sem login e conteúdo ativo podia executar na origem do Brain | **Corrigido no estado atual:** leitura autenticada, allowlist, assinatura de arquivo, `nosniff`, CSP sandbox e bloqueio de extensões ativas; a separação física de origem permanece como endurecimento futuro |
| Média | Limite de login confiava diretamente em `X-Forwarded-For` | Um cliente podia trocar o cabeçalho e contornar o limite por IP em certas topologias | **Corrigido no estado atual:** `req.ip`, confiança em proxy opt-in, buckets expirados e memória limitada |
| Média | Build LAN antigo usa token no `localStorage` | Um artefato gerado e rastreado preserva o modelo antigo de autenticação, diferente do código-fonte atual | Retirar builds gerados do repositório público, purgar o artefato antigo e impedir regressão no CI |
| Média | Service worker antigo armazena respostas autenticadas | Dados pessoais podem permanecer no cache do navegador após logout ou falha de rede | Remover cache de APIs autenticadas e limpar apenas caches pertencentes ao Brain |
| Baixa | Health check devolvia erro bruto do PostgreSQL | Falhas podiam revelar detalhes internos da implantação | **Corrigido:** resposta pública genérica e detalhe somente no log do servidor |
| Baixa | Limpeza removia todos os caches da origem | Em uma origem compartilhada, o Brain podia apagar caches e workers de outros sistemas | **Corrigido:** escopo/script exatos e caches próprios do Brain |
| Baixa | Fontes e ícones externos eram carregados automaticamente | Google/Icons8 recebiam metadados de rede sem escolha do usuário | **Corrigido:** tipografia do sistema e SVGs locais; CSP permanece como endurecimento futuro |
| Baixa | Documentação e serviços expõem detalhes do ambiente pessoal | Usuário, caminhos, IP, túnel e sistemas vizinhos facilitam reconhecimento da infraestrutura | **Corrigido no estado rastreado:** exemplos usam conta e caminho genéricos; relatórios privados foram retirados do índice |

### Revisão final — endurecimento de recursos (2026-09-21)

| Prioridade | Achado | Estado atual | Limite residual |
| --- | --- | --- | --- |
| Alta | Uploads podiam ocupar disco sem teto agregado | **Corrigido na instalação de processo único:** capacidade total configurável (5 GiB padrão), reserva concorrente antes da gravação, rejeição sem `Content-Length`, limites menores de tamanho e vazão | Réplicas múltiplas exigem quota compartilhada; o Compose oficial usa uma única réplica |
| Média | Capas e emojis podiam escapar como órfãos após falha/404 | **Corrigido:** o arquivo recém-gravado é removido quando o `UPDATE`/`INSERT` falha | Arquivos antigos sem referência pedem uma coleta de lixo planejada, não uma remoção automática cega |
| Média | Snapshots podiam crescer indefinidamente por página | **Corrigido:** retenção configurável de 1 a 1000 versões por página, 100 por padrão | Muitas páginas ainda podem crescer o banco; backup e capacidade continuam responsabilidade do operador |
| Condicional alta | Cookie sem `Secure` se alguém expuser HTTP em LAN | **Mitigado por desenho e documentação:** Compose publica apenas em loopback; acesso LAN/internet exige proxy TLS e `AUTH_COOKIE_SECURE=true` | A composição HTTP não deve ser exposta diretamente |

O dump sensível foi inspecionado somente o necessário para confirmar classes de informação e alcance. Valores literais não devem ser copiados para este documento, issues ou mensagens de commit.

### Divergências de configuração e portabilidade

- O backend usa loopback por padrão; exposição em LAN precisa ser uma decisão explícita da instalação.
- README e código usam a mesma variável `TERMINAL_DEFAULT_DIR`.
- O terminal herda todo o ambiente do backend; portanto, quando habilitado hoje, o shell também recebe variáveis sensíveis do processo.
- Integrações com OpenAI, gravação Android e Telegram podem transferir conteúdo para serviços externos quando habilitadas. Elas deverão ser opcionais, transparentes e documentadas como exceções ao funcionamento local.
- Os dados principais de páginas/pastas não implementam isolamento completo entre múltiplos usuários. A primeira edição pública deve declarar claramente o modelo de instância pessoal, sem prometer multiusuário até que haja autorização por proprietário.
- A integração de gravação/Remember também opera como um corpus pessoal global. Isso é compatível com a primeira edição de instância individual, mas precisará de propriedade por usuário antes de qualquer promessa de multiusuário.
- Os builds rastreados estão divergentes do código-fonte atual. Em especial, o build LAN ainda contém autenticação antiga e cache de API; builds gerados não devem compor o repositório público.
- A limpeza atual de service workers e caches usa a origem inteira. Como o Brain pode viver sob `/brain/`, ela deve ser limitada a caches com nomes próprios do projeto.

## Inventário público/privado proposto

### Pode compor a edição pública após revisão

- Código-fonte do backend e frontend.
- Esquema e migrações sem registros pessoais.
- Ícones e recursos visuais próprios/licenciados.
- Testes sem dados reais.
- Configurações de exemplo sem credenciais ou endereços particulares.
- Dockerfiles, Compose e scripts de inicialização genéricos.
- Conteúdo fictício de demonstração.
- Documentação pública e política de segurança.

### Deve permanecer privado

- `.env` reais e quaisquer tokens, chaves ou senhas.
- Banco de dados e dumps da instância pessoal.
- Diretório legado de páginas privadas, uploads, áudios, memórias e exportações reais.
- Certificados, cookies, sessões e segredos de TOTP.
- Endereços internos e detalhes que só pertencem à infraestrutura pessoal.
- Backups da instalação e configurações operacionais com valores reais.

## Plano de execução detalhado

### Etapa 1 — concluir a auditoria

- [x] Inventariar arquivos rastreados e ignorados.
- [x] Identificar dump e uploads reais rastreados.
- [x] Identificar arquivos `.env` e registrar apenas os nomes das variáveis, sem valores.
- [x] Mapear autenticação, autorização e sessões.
- [x] Mapear uploads, leitura de arquivos e prevenção de travessia de caminhos.
- [x] Mapear terminal, Socket.IO, `tmux` e raízes permitidas.
- [x] Mapear integrações externas, especialmente IA e a gravação Android.
- [x] Verificar CORS, cookies, proxies e modos LAN/subpasta.
- [x] Mapear processos atuais de build/publicação e suas particularidades locais.
- [x] Concluir a revisão de dependências e licenças (dependências de produção saneadas e licença MIT definida).
- [x] Produzir e fechar o relatório de segurança privado.
- [x] Validar os primeiros achados críticos de publicação, terminal, uploads, limite de login e health check.

### Etapa 2 — separar instalação pessoal e produto público

- [ ] Definir um perfil `private` para a instalação atual e um perfil público genérico.
- [ ] Manter dados persistentes fora da árvore versionada.
- [x] Remover do índice os arquivos pessoais atualmente rastreados, sem apagar os originais privados.
- [x] Remover do índice os builds de produção gerados e divergentes, preservando-os no disco local.
- [x] Remover do índice a configuração de túnel específica e substituí-la por um exemplo neutro.
- [x] Fortalecer o `.gitignore` para dados, backups, ambientes e builds gerados.
- [x] Sanear o histórico Git em uma cópia preparada para publicação, sem remoto configurado.
- [ ] Validar que a instalação pessoal continua funcionando após a separação.

### Etapa 3 — configuração segura por ambiente

- [x] Criar `backend/.env.example` sem valores reais.
- [x] Criar `frontend/.env.example` sem valores reais.
- [x] Criar `frontend/.env.example` com domínio neutro e somente rotas públicas.
- [ ] Centralizar leitura, validação e valores padrão seguros.
- [x] Eliminar IPs, nomes de usuário e caminhos pessoais codificados do estado rastreado.
- [ ] Gerar segredos de instalação em vez de fornecer segredos padrão.
- [ ] Documentar variáveis obrigatórias, opcionais e sensíveis.

### Etapa 4 — persistência local

- [x] Definir volumes separados para PostgreSQL e uploads.
- [x] Garantir que nenhuma telemetria ou sincronização externa seja obrigatória no perfil Docker.
- [x] Permitir provedores de IA opcionais e claramente configuráveis.
- [ ] Documentar backup, restauração, exportação e exclusão de dados.
- [ ] Validar que uma instalação nova não aponta para a infraestrutura do autor.

### Etapa 5 — recursos sensíveis

- [x] Introduzir `TERMINAL_ENABLED=false` como comportamento padrão e fail-closed.
- [x] Não registrar rotas nem eventos do terminal e não abrir/restaurar sua interface quando estiver desativado.
- [ ] Restringir diretórios mesmo quando o terminal for habilitado.
- [x] Impedir que shells habilitados herdem credenciais e tokens do processo backend.
- [ ] Concluir o isolamento do shell além do ambiente, incluindo permissões do processo e acesso ao filesystem.
- [ ] Revisar autenticação, autorização e ciclo de vida das sessões.
- [ ] Aplicar o mesmo modelo de opt-in às integrações que ampliam acesso a dados.
- [x] Exigir autenticação para leitura de uploads e bloquear conteúdo ativo ou disfarçado.

### Etapa 6 — instalação com Docker

- [x] Criar imagens separadas para frontend e backend, unificadas por proxy interno.
- [x] Adicionar PostgreSQL com volume persistente e verificação de saúde.
- [x] Definir inicialização idempotente do esquema, segredos locais gerados e assistente de primeiro acesso.
- [x] Evitar portas públicas desnecessárias; publicar apenas a entrada web em loopback.
- [x] Testar instalação do zero e atualização sem perda de dados.

### Etapa 7 — demonstração fictícia

- [x] Criar usuário de primeiro acesso por fluxo seguro, não por credencial fixa pública.
- [x] Criar páginas fictícias para editor, árvore e quadro infinito.
- [x] Não incluir arquivos de demonstração nem metadados pessoais.
- [x] Tornar o carregamento dos dados de demonstração opcional e repetível.

### Etapa 8 — apresentação pública

- [x] Reescrever README com proposta, instalação rápida e limites de segurança.
- [x] Adicionar arquitetura e modelo de dados em alto nível.
- [x] Criar guias de instalação, atualização, backup e solução de problemas.
- [x] Escolher licença MIT após confirmar a compatibilidade das dependências e a intenção do projeto.
- [x] Adicionar `CONTRIBUTING.md`, `SECURITY.md` e templates de issue.
- [ ] Criar imagens com dados exclusivamente fictícios.

### Etapa 9 — portão de publicação

- [x] Procurar segredos no estado atual e no histórico preparado.
- [x] Confirmar ausência dos caminhos privados e padrões de credenciais no histórico preparado.
- [x] Executar testes, lint e builds de backend, padrão e subpasta.
- [x] Testar instalação Docker em ambiente limpo, sem arquivo `.env`.
- [ ] Testar backup e restauração.
- [x] Revisar dependências e licenças (frontend e backend sem vulnerabilidades de produção; licença MIT aplicada).
- [x] Aplicar limite de capacidade, retenção e vazão para recursos persistentes.
- [x] Fazer revisão manual final dos arquivos que serão públicos.
- [ ] Somente então criar ou tornar público o repositório de destino.

## Registro de decisões

| Data | Decisão | Motivo |
| --- | --- | --- |
| 2026-09-21 | Adotar modelo local-first/self-hosted | Cada usuário deve controlar seus próprios dados |
| 2026-09-21 | Manter a instalação pessoal separada | Evitar exposição e não interromper o uso diário |
| 2026-09-21 | Terminal desativado por padrão | Reduzir a superfície de ataque da instalação padrão |
| 2026-09-21 | Não publicar antes da limpeza do histórico | Remover arquivos no commit atual não elimina versões antigas |

## Diário de andamento

### 2026-09-21

- Documento mestre criado.
- Auditoria estática de segurança iniciada para todo o repositório.
- Inventário Git encontrou dump de banco, uploads e configuração de túnel rastreados.
- Confirmada a ausência inicial de Docker Compose, arquivos `.env.example` e licença.
- Confirmado que o dump rastreado contém dados reais e material sensível; nenhum valor foi reproduzido na documentação.
- Confirmado que o terminal não possui chave de desativação e herda o ambiente do backend.
- Confirmado que a leitura de `/uploads` não exige autenticação e que a validação de tipo de arquivo é insuficiente.
- Confirmado que o limitador de login usa diretamente um cabeçalho encaminhado controlável em determinadas implantações.
- Confirmado que o health check público devolve detalhes brutos de falha do banco.
- Revisados todos os 186 arquivos rastreados no snapshot da auditoria.
- Confirmado que o build LAN rastreado ainda usa autenticação por token em `localStorage` e instala cache de respostas autenticadas.
- Confirmado que a limpeza atual apaga todos os caches da origem, inclusive possíveis caches de sistemas vizinhos.
- Confirmadas requisições automáticas para Google Fonts e Icons8, incompatíveis com o objetivo local-first sem rastreamento implícito.
- Confirmado que runbooks, scripts e unidades de serviço precisam ser sanitizados e parametrizados.
- Varredura de segurança finalizada com 10 achados: 1 crítico, 2 altos, 3 médios e 4 baixos.
- Dois candidatos foram rejeitados como vulnerabilidades independentes: URL persistida de anexo, por depender do problema de uploads já registrado e das proteções atuais do React/navegador; e isolamento da integração de gravação entre usuários, porque a edição atual é explicitamente uma instância pessoal sem cadastro multiusuário.
- Iniciada a separação público/privado: dump SQL, quatro uploads reais, build LAN, artefatos de túnel e `.env.túnel` foram retirados somente do índice Git.
- Confirmado como regra operacional que `git rm --cached` não apagou os arquivos da instalação local.
- `.gitignore` reorganizado para impedir dados, backups, ambientes reais e builds gerados na edição pública, mantendo arquivos `.env.example` permitidos.
- Criados `frontend/.env.example` e `frontend/.env.example` com valores neutros.
- Criado `backend/.env.example` com defaults locais e integrações opcionais vazias.
- Terminal protegido por opt-in nos dois lados: `TERMINAL_ENABLED=false` no backend e `VITE_TERMINAL_ENABLED=false` no frontend público.
- Quando desligado, as quatro rotas `/api/terminal/*` não são registradas, os seis eventos Socket.IO do terminal não são registrados, a URL direta volta à página inicial e abas antigas não são consultadas nem restauradas.
- Adicionada defesa no próprio serviço: uma chamada interna futura para criar PTY falha antes de executar `tmux` quando o recurso está desligado.
- A instalação privada local recebeu as duas chaves como `true` apenas nos arquivos `.env` ignorados pelo Git; nenhum valor secreto foi exposto ou versionado.
- Validação desta etapa: backend TypeScript compilou; no perfil público, 11 testes passaram e 4 específicos do terminal foram corretamente ignorados; no perfil privado, 20 testes passaram e 2 casos exclusivos do modo desligado foram corretamente ignorados; builds de produção passaram nos dois perfis.
- A revisão pós-correção detectou que os testes antigos presumiam terminal sempre ligado; a suíte foi ajustada para controlar os dois perfis e agora confirma que a rota redireciona e que nenhuma consulta de abas ocorre no default público.
- A suíte frontend completa no perfil público executou 183 testes: 178 passaram, 4 foram ignorados por pertencerem ao terminal habilitado e 1 teste de login 2FA falhou de forma transitória por não localizar o campo; esse arquivo foi reexecutado isoladamente e passou 4/4. A instabilidade deve continuar registrada até uma execução completa integralmente verde.
- Fechado o achado alto de uploads no estado atual: `/uploads` agora exige sessão válida antes do acesso ao filesystem.
- A leitura de arquivos aplica allowlist também aos objetos legados, recusa extensões ativas/desconhecidas e envia `nosniff`, CSP `sandbox`, política de cache privado e `Cross-Origin-Resource-Policy: same-site`, preservando suporte a Range.
- Imagem inline, capa, emoji e anexo agora exigem concordância entre extensão e MIME e validam a assinatura/conteúdo gravado antes de devolver qualquer URL. Arquivos disfarçados são apagados imediatamente.
- Adicionada suíte backend com 6 testes de política de upload, incluindo PNG/PDF reais e conteúdo HTML disfarçado; todos passaram após compilação TypeScript.
- Validação HTTP isolada, sem reiniciar a instância atual: leitura sem sessão retornou `401`; PDF autenticado com Range retornou `206`; quatro tentativas de conteúdo ativo disfarçado retornaram `400` e não deixaram arquivos; PNG legítimo retornou `200`, pôde ser lido e o artefato temporário de teste foi removido.
- Removida a herança integral de `process.env` pelo terminal habilitado. PTY, criação de servidor/sessão e todos os clientes `tmux` agora recebem apenas HOME, USER, LOGNAME, SHELL, PATH, locale, TERM e COLORTERM.
- Credenciais do backend, tokens, chaves de API, `SSH_AUTH_SOCK` e variáveis arbitrárias não entram mais no shell nem no ambiente global do servidor `tmux` dedicado.
- O `update-environment` do tmux foi desativado para impedir que anexos/reconexões reintroduzam variáveis do processo.
- Adicionado socket tmux versionado: na primeira criação após a atualização, o servidor do socket legado é encerrado diretamente, sem confiar em uma marca modificável pelo próprio shell. Isso encerra uma única vez terminais persistentes antigos; sessões posteriores continuam persistentes no socket seguro.
- Dois testes unitários do ambiente do terminal foram adicionados; a suíte backend completa passou 8/8.
- Uma sessão real foi criada em socket temporário com segredos sentinela no processo pai: shell, PATH, HOME, SHELL e TERM funcionaram, enquanto os sentinelas ficaram ausentes tanto do shell quanto do ambiente global do tmux.
- A revisão pós-correção encontrou e eliminou dois problemas: uma sessão antiga podia falsificar a marca de migração e o helper removia whitespace do snapshot. A validação final confirmou também que um servidor legado real é encerrado.
- Limite arquitetural mantido em aberto: enquanto terminal e backend executarem sob o mesmo usuário Unix, um shell completo ainda pode tentar ler `/proc` ou arquivos acessíveis à conta do serviço. A edição pública continua segura por manter o terminal desligado; uma habilitação futura com confidencialidade forte exigirá processo/usuário ou container separado.
- Fechado o achado médio de spoofing no limite de login: nenhum código de autenticação lê `X-Forwarded-For` ou `X-Forwarded-Proto` diretamente; IP e HTTPS passam exclusivamente pela política `trust proxy` do Express.
- A edição pública não confia em proxy por padrão. `TRUSTED_PROXIES` vazio ignora cabeçalhos encaminhados; a instalação privada atual preserva o nginx local com `TRUSTED_PROXIES=loopback` apenas no `.env` ignorado.
- O IP resolvido é compartilhado pelo bloqueio de login e registro de dispositivos confiáveis. Prefixos forjados não criam buckets novos e a decisão de cookie `Secure` usa somente `req.secure`.
- Buckets de IP antigos são removidos, o mapa é limitado a 10 mil entradas e, ao atingir o limite, apenas buckets não bloqueados podem ser substituídos. Se todos estiverem bloqueados, novos clientes falham fechados sem criar memória ilimitada.
- A primeira revisão detectou confiança local excessiva e um bucket global capaz de causar bloqueio transversal; ambos foram removidos antes do fechamento.
- A suíte backend passou 13/13, incluindo proxy não confiável, proxy loopback explícito, prefixo XFF forjado, configuração pública sem confiança e bloqueio após cabeçalhos rotativos.
- Fechado o vazamento do health check: falhas do PostgreSQL retornam apenas `503` com estado genérico; o detalhe técnico fica no log estruturado do servidor.
- Testes exercitam diretamente o handler: sucesso preserva `200` e `db: connected`; erro com senha/host sentinela preserva `503`, não inclui o segredo no corpo e registra o detalhe somente no log. Suíte backend: 15/15.
- Fechado o achado de limpeza ampla: o frontend só desregistra o worker legado quando scope e `sw.js` coincidem exatamente com a base atual (`/` ou `/brain/`).
- Caches Workbox são removidos apenas para o scope do Brain; caches com prefixo reservado também são próprios. Os nomes genéricos históricos `api-cache` e `pdf-bypass` só são removidos quando o worker legado exato comprova a propriedade.
- Registros mistos com um worker novo em instalação/espera são preservados, assim como caches e workers de aplicações vizinhas.
- Validação final: teste focado 4/4; suíte frontend completa anterior à última revisão 185 aprovados e 2 ignorados; após os ajustes finais, builds de produção concluíram com sucesso.
- Fechado o carregamento externo automático: removido Google Fonts, adotada pilha tipográfica do sistema e substituídos terminal, notas/memória e configurações por SVGs locais autorais.
- Abas antigas salvas no navegador migram somente as duas URLs internas exatas do Icons8 para assets locais; URLs customizadas de páginas continuam preservadas.
- Validação: testes focados 14 aprovados/2 condicionais ignorados; suíte frontend completa 186 aprovados/2 ignorados; builds de produção concluídos. Nenhum Google Fonts/gstatic aparece nas fontes ou bundles; as strings Icons8 restantes existem apenas no mapa de migração, sem uso como `src`.
- Sanitizados README, script de build, importador, backup e unidades systemd: removidos IP, túnel, usuário, caminhos e nomes de sistemas particulares.
- O backend agora escuta somente em loopback por padrão e aceita CORS apenas da lista explícita `CORS_ORIGIN` (com localhost de desenvolvimento apenas em modo development).
- Relatório de segurança e planos operacionais históricos foram retirados somente do índice Git e continuam preservados localmente sob regras de ignore.
- Os exemplos systemd usam conta dedicada `brain-core` e raiz genérica `/opt/brain-core`; o script de build não reinicia processos nem recarrega proxy.
- Validação da sanitização: busca no conteúdo rastreado não encontrou nome do operador, caminho residencial, IP privado, domínio de túnel nem nomes de sistemas vizinhos.
- `systemd-analyze verify` aceitou as três unidades e o timer de exemplo sem mensagens; `bash -n`, `node --check` e `git diff --check` também passaram.
- Backend: compilação e 15/15 testes aprovados. Frontend: 35 arquivos, 186 testes aprovados e 2 condicionais ignorados; builds de raiz e base alternativa concluídos.
- A revisão independente pós-correção encontrou dois pontos nos exemplos: placeholder JWT longo e CORS na porta de desenvolvimento. O JWT de exemplo agora é deliberadamente inválido, a geração segura usa `openssl rand -hex 32` e o CORS corresponde ao frontend documentado na porta 8001.
- Criada composição Docker local-first com PostgreSQL, backend e proxy web. Banco e uploads usam volumes separados; somente a interface web é publicada, ligada a `127.0.0.1:8080` por padrão.
- A inicialização do backend agora cria o esquema canônico de uma instalação nova e pode criar somente o primeiro administrador por variáveis privadas. Não existe senha de demonstração fixa.
- Ensaio descartável concluído: imagens construídas do zero, banco e backend saudáveis, health check retornou `200` e o administrador inicial autenticou. Contêineres, rede e os dois volumes exclusivos `brain-core-smoke` foram removidos após a validação.
- Corrigida uma inconsistência de upload que só aparecia em instalação compilada: editor, anexos e emojis agora usam a mesma variável `UPLOADS_DIR`, montada no volume do contêiner.
- Seed fictício concluído: `SEED_DEMO_DATA=true` cria uma seção de boas-vindas, uma subpágina de planejamento e um mapa visual em um banco vazio. O seed é inofensivo em instalações existentes porque não executa quando já há páginas.
- Ensaio Docker de demo validou as três páginas e a migração `is_section`; os volumes temporários foram removidos ao fim do teste.
- Documentação pública reestruturada: README local-first, arquitetura, contribuição, política de segurança e templates de issue. A licença permanece pendente de decisão explícita do autor.
- Atualização Docker validada: três páginas fictícias persistiram após `down` sem volumes e novo `up`; rede, contêineres e volumes exclusivos do ensaio foram então removidos.
- Histórico medido sem alteração: 15 commits ainda referenciam objetos privados antigos. Criado guia para filtrar uma cópia descartável, nunca o repositório de trabalho.
- Revisão de dependências do backend: removidos `uuid` e seus tipos, pois não eram usados, e Express foi atualizado dentro da major version. Testes passaram. Restam duas vulnerabilidades moderadas transitivas em `body-parser/qs`; a correção automática exige avaliar migração para Express 5.
- Nenhum dado foi removido, movido ou publicado.
- Revisão final de recursos: além dos limites de conteúdo já existentes, os quatro caminhos de upload agora passam por uma quota global local. A quota reserva o `Content-Length` dentro de uma seção crítica antes de o Multer gravar; por isso requisições concorrentes da mesma instância não podem aprovar o mesmo espaço. Upload sem tamanho declarado é recusado, pois não pode ser contabilizado com segurança.
- O padrão é 5 GiB (`UPLOADS_MAX_BYTES`), configurável apenas pelo operador. Anexo individual foi reduzido de 200 MB para 25 MB; imagem, capa, emoji e anexo têm também limitação de requisições autenticadas antes da escrita.
- Arquivo de capa recém-gravado é apagado quando a página não existe/está na lixeira ou o banco falha. O mesmo ocorre com emoji cujo `INSERT` falha. Não foi implementada limpeza automática retroativa de arquivos legados, para evitar apagar conteúdo que ainda possa ser referenciado em documentos antigos.
- `page_versions` passa a manter no máximo `PAGE_VERSION_RETENTION` versões por página (100 padrão, intervalo efetivo 1–1000), com ordenação estável. A suíte backend compilou e passou 16/16 após o endurecimento, incluindo quota sem tamanho e quota excedida; `git diff --check` também passou.
- Revisão pós-correção independente confirmou a retenção e o posicionamento dos rate limits. Os limites da primeira edição são deliberadamente locais e de processo único; uma futura edição com múltiplas réplicas exigirá quota e rate limit compartilhados.
- Auditoria de dependências refeita com `npm audit --omit=dev`: backend permanece com 2 vulnerabilidades moderadas transitivas de `body-parser/qs`, cuja correção automática exige avaliar Express 5. No frontend, a atualização compatível reduziu o resultado de 36 achados (6 altos) para 29 (1 alto, 28 moderados), todos na árvore transitiva do `tldraw`/Tiptap. A correção restante exige `tldraw@5`, uma migração major que deve ser tratada e testada separadamente.
- A atualização compatível do frontend foi instalada e gerou com sucesso os builds de produção. O teste isolado que havia oscilado após reinstalação (`NotasBoard`) passou 4/4; a execução integral seguinte excedeu o tempo de supervisão local e não é considerada validação completa. O portão final ainda exige uma execução integral verde.
- Busca no conteúdo atualmente rastreado não encontrou chaves privadas, tokens em formatos conhecidos nem diretórios privados antes rastreados (`uploads`, `backups`, builds e arquivos `.env` reais). Isso não substitui a limpeza obrigatória do histórico preparado para publicação.
- Migração do quadro visual concluída: `tldraw` foi atualizado da série 3 para a 5 e o Tiptap direto foi atualizado aos patches corrigidos. A única API removida usada pelo Brain era `inferDarkMode`; o quadro mantém a preferência de tema própria da biblioteca. A compilação TypeScript e ambos os builds de frontend concluíram após a migração.
- Auditoria final de produção do frontend: `npm audit --omit=dev` retornou 0 vulnerabilidades. A execução integral da suíte encontrou uma oscilação já vista em teste de Remember sob execução concorrente; o arquivo isolado passou 11/11. O portão final continua exigindo uma execução integral verde e registrada.
- Migração do backend concluída: Express foi atualizado da série 4 para a 5, removendo as duas vulnerabilidades transitivas de `body-parser/qs`. A tipagem mais estrita revelou parâmetros de rota que podiam ser tratados como vetores; eles agora são declarados como parâmetros escalares nos handlers correspondentes. Compilação e suíte backend passaram 16/16; `npm audit --omit=dev` retornou 0 vulnerabilidades de produção.
- Histórico público preparado em uma cópia descartável e isolada, nunca no checkout de trabalho: `git filter-repo` reescreveu 129 commits para 119, excluindo dump, uploads, configuração de túnel e documentos privados. A cópia resultante não possui remoto, passou `git fsck --no-reflogs --unreachable` e não contém os caminhos removidos nem padrões comuns de chaves de acesso em nenhum commit alcançável. Ela ainda não foi enviada a lugar algum; o destino novo continua uma decisão explícita do autor.
- Licença definida como MIT: adicionados `LICENSE`, metadados SPDX nos dois pacotes e orientação no README. A nota de marca deixa claro que a permissão de código não autoriza representação como projeto oficial.
- Portão de qualidade de frontend concluído de forma reprodutível em um único worker: Vitest executou 70 arquivos, com 186 testes aprovados, 0 falhas e 2 casos condicionais ignorados. ESLint e a verificação TypeScript também concluíram; os builds de produção já haviam concluído após a atualização das dependências. A suíte backend permanece 16/16 aprovada.
- Revisão manual final do estado rastreado: inventário completo de arquivos, busca por nomes de dados privados e busca por caminhos de máquina, IPs internos, domínio de túnel e padrões de credenciais. Nenhum dado pessoal, segredo ou artefato gerado foi encontrado. As poucas ocorrências restantes são nomes de variáveis, documentação de backup, exemplos de configuração e valores sintéticos de teste.
- Assistente de primeiro acesso concluído: `docker compose up --build -d` gera os segredos locais no volume privado, o navegador identifica banco sem usuários e cria o administrador uma única vez. Em ensaio Docker descartável, o estado passou de `setupRequired: true` para `false` após a criação e uma segunda tentativa recebeu `409`; rede, contêineres e volumes do ensaio foram removidos.
