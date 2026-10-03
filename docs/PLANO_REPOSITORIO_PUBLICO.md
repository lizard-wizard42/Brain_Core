# Transição para o repositório público

A transição de desenvolvimento está concluída: [Brain_Core](https://github.com/lizard-wizard42/Brain_Core) é o repositório público canônico. A antiga origem privada está arquivada. Não é necessário manter dois repositórios ativos.

Este documento substitui o plano histórico de preparação. O plano antigo descrevia uma instalação e etapas já superadas; suas pendências e comandos não representam o estado atual.

| Responsabilidade | Local atual |
| --- | --- |
| Código, exemplos neutros e documentação | Repositório público canônico. |
| Contas, páginas, anexos, áudio e transcrições | Banco/volumes/diretórios privados da instalação. |
| Tokens, configurações e assinatura Android | Arquivos privados fora do Git. |
| Backup completo | Destino privado configurado pelo operador. |
| Relatórios e evidências de segurança | Artefatos privados; somente correções sanitizadas seguem para o repositório. |

O `.gitignore`, o check de publicação e o CI são proteções adicionais. Revise conteúdo e metadados antes de cada push. A instalação pessoal não deve ser usada como demonstração ou fixture de teste.

O procedimento atual está em [PUBLICACAO.md](PUBLICACAO.md). Mudanças de produto e seus limites estão no [CHANGELOG](../CHANGELOG.md); arquitetura, MCP, Memory e backup têm guias próprios.
