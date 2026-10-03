# Publicação e manutenção do repositório

O repositório canônico é [Brain_Core](https://github.com/lizard-wizard42/Brain_Core), público. A antiga origem privada está arquivada e não é um segundo destino de desenvolvimento. Código e documentação vão para o canônico; dados da instalação permanecem fora do Git.

## Antes de enviar

1. Trabalhe em uma branch e revise `git diff --check`, arquivos novos e metadados do commit.
2. Use apenas dados fictícios nos testes, imagens e exemplos. Não inclua bancos, uploads, áudio, transcrições reais, arquivos `.env`, tokens ou chaves de assinatura Android.
3. Configure o endereço GitHub `noreply` do autor. A política do projeto não usa trailers de coautoria automática de agentes.
4. Execute `bash scripts/public-release-check.sh`, testes pertinentes e `./build.sh`; consulte [CONTRIBUTING.md](../CONTRIBUTING.md).
5. Abra um PR, aguarde os checks obrigatórios e atualize a instalação usando o processo de [manutenção](MAINTAINER_WORKFLOW.md).

O check público examina caminhos rastreados, padrões de credenciais, caminhos de máquina/IPs particulares e metadados da ancestralidade Git. Ele complementa a revisão: não consegue identificar todo texto pessoal arbitrário. Confira também os arquivos novos ainda não rastreados antes do commit.

Não reescreva `main` nem desative sua proteção para uma atualização comum. A preparação histórica da origem pública já ocorreu; comandos antigos de filtragem não são etapas rotineiras de release.

## Estado operacional

Os guias distinguem instalação nativa, Docker, Android e serviços opcionais. Novas variáveis, alterações de persistência e limites das funcionalidades devem aparecer no guia correspondente e no [CHANGELOG](../CHANGELOG.md).

Relatórios técnicos de segurança permanecem privados, seguindo [SECURITY.md](../SECURITY.md). Publicar a correção não autoriza publicar dumps, conteúdo pessoal ou detalhes de exploração em issues.
