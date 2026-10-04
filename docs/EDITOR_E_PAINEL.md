# Editor e painel inicial

## Páginas e referências

Subpáginas e referências possuem rótulos distintos no editor. Uma referência inserida com `@` aponta para uma página existente: **Remover referência** remove apenas esse bloco, sem mover a página de destino para a lixeira. A alteração do documento segue o salvamento normal do editor.

**Mover página para a lixeira** pede confirmação e só remove o bloco após a API confirmar a operação. A página pode ser restaurada pela lixeira. Se a operação falhar, o bloco permanece visível e o diálogo oferece nova tentativa.

**Renomear página** altera o título da página de destino, inclusive quando acionado numa referência. Salvar/Enter confirma, Cancelar/Escape descarta o nome digitado. Uma falha mantém o texto digitado para nova tentativa.

As ações ficam visíveis para toque e são acessíveis por teclado. O diálogo começa com foco em Cancelar, mantém Tab dentro dele e devolve o foco ao botão de origem quando fechado.

## Busca com `@`

Digite `@` e parte do título para referenciar uma página. A busca ignora acentos e espaços no início/fim; o nome da página pai ajuda a distinguir resultados com o mesmo título. Até oito resultados aparecem por vez. Quando houver mais, continue digitando para filtrar.

Use ↑/↓ para escolher, Enter para inserir e Esc para fechar. Uma busca sem resultados permanece visível com uma explicação, sem interceptar Enter ou as setas do editor. O menu se reposiciona para permanecer dentro da tela e acompanha mudanças de tamanho da janela.

## Painel inicial

**Continue daqui** abre a página mais recentemente editada. Os painéis de páginas e gravações distinguem carregamento, erro e lista vazia. **Tentar novamente** repete apenas a consulta que falhou; falha de consulta não significa ausência de conteúdo.

O status das gravações aparece em texto. Uma transcrição com erro permanece identificada como erro, mesmo que possua texto parcial. As consultas preservam o recorte de dia de São Paulo, incluindo sessões do dia seguinte em UTC.

As mudanças não exigem migração de dados nem novas variáveis de ambiente.


## Busca unificada

A busca lateral pesquisa títulos e conteúdo de páginas e notas rápidas da conta.
Resultados mostram um trecho destacado e o caminho da página; o filtro alterna
entre as duas coleções. A busca ignora maiúsculas e acentos comuns do português,
e “Carregar mais resultados” pagina os resultados em grupos de 20.

Somente o texto dos blocos do editor é pesquisado, sem atributos, URLs de anexos
ou dados internos dos canvases. Notas rápidas incluem o corpo e itens de checklist.
Páginas na lixeira e páginas de outras contas não entram nos resultados. Áudios
e transcrições continuam em sua busca própria. Um resultado de nota rápida abre
o quadro com foco na nota correspondente. Falhas oferecem nova tentativa.
