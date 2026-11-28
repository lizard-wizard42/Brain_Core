# Modo Design

O Design usa quadros com dimensões em pixels e elementos editáveis. Crie um quadro pelo preset, adicione cartões ou escolha **+ Imagens**. Ao selecionar várias imagens, o editor cria um quadro no tamanho de cada arquivo e mostra o progresso. O envio respeita o limite do servidor; importar dezenas de artes pode levar alguns minutos. As páginas e imagens existentes não são apagadas pela importação.

Selecione uma camada para editar posição, tamanho, opacidade e, nos cartões, título e corpo com tamanhos, pesos e cores próprios, alinhamento, espaçamento, gradiente, borda e sombra. **+ Forma** cria retângulos, círculos/elipses e linhas com cores hexadecimais e contorno. Imagens podem ser redimensionadas no canvas ou trocadas no painel. Clicar em um quadro na lista centraliza a câmera. Pan funciona pelo botão, Espaço ou botão do meio do mouse.

Os controles **Desfazer**, **Refazer**, **Duplicar** e **Excluir** também usam `Ctrl+Z`, `Ctrl+Y` (ou `Ctrl+Shift+Z`), `Ctrl+D` e `Delete`. Selecione dois ou mais elementos do mesmo quadro para **Agrupar**; **Desagrupar** preserva a posição das camadas. Os atalhos não interceptam edição de campos de texto. Excluir um quadro também remove seus elementos; o histórico local permite desfazer até 100 operações da sessão. Atualizações externas substituem esse histórico local após a revisão ser sincronizada.

Enquanto o Design está aberto, o editor consulta revisões externas a cada três segundos. Se houver mudanças locais ainda não salvas, ele avisa em vez de sobrescrevê-las.

**Prévia** e **Baixar PNG** exportam o quadro ativo. **Baixar quadros ZIP** empacota até 50 quadros da página, em PNG, no tamanho definido por cada quadro e na escala selecionada. O lote é limitado a 250 MiB para proteger a memória do navegador. A prévia MCP é gerada ao abrir ou salvar um Design no navegador e fica vinculada à revisão atual; o servidor não renderiza quadros que ainda não foram abertos no editor.

O tracejado de seleção dos grupos é apenas um guia do editor e não aparece nas imagens exportadas. Os atalhos do editor funcionam enquanto o foco está na página; depois de clicar na barra de endereço ou em controles do navegador, clique novamente no Brain Core antes de usá-los.

Para arquivos em outro computador, a seleção de imagens funciona pelo navegador local. A ferramenta MCP opcional `brain_assets_upload_local` lê arquivos apenas da pasta configurada no computador onde o adaptador MCP está executando; veja [o guia MCP](NOTES_MCP.md).
