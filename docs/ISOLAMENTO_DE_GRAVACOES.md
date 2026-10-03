# Isolamento de gravações por conta

Cobre o áudio capturado pelo navegador e pelo Android. Os demais pontos de isolamento multiusuário precisam de validação própria antes de liberar uma segunda conta real.

## Regra de propriedade
- Uma gravação nova recebe o ID da conta no início da captura (IndexedDB no navegador; `sessions.owner_user_id` no SQLite do Android).
- O navegador só envia, conclui e recupera sessões da conta autenticada naquele momento; a API confere `owner_user_id` contra o usuário da sessão HTTP antes de aceitar áudio. Trocar de login durante a permissão do microfone cancela o início.
- Rotas de gravação validam UUIDs completos (8-4-4-4-12).
- O Android mantém o token do dispositivo fixo durante cada execução do worker e só envia sessões do mesmo proprietário; a API confere `owner_user_id` contra o dono do token. Trocar de conta interrompe o lote em andamento.
- A captura nativa exige uma conta previamente vinculada, inclusive offline.
- Ao concluir uma sessão, navegador e Android encaminham ao Memory o proprietário derivado da autenticação. O Memory atualiza o estado apenas quando ID e proprietário correspondem no mesmo `UPDATE`; proprietário ausente corresponde exclusivamente a sessões legadas sem dono. As duas aliases da rota seguem essa regra.
- A atribuição e o upload pelo navegador recusam um ID já registrado no Android sob outra conta. A verificação atômica no Memory também protege contra registros antigos incorretos e colisões entre requisições concorrentes.

## Migração sem atribuição silenciosa
- Sessões antigas do navegador sem proprietário ficam no IndexedDB; o usuário pode atribuí-las explicitamente à conta atual, e o servidor confirma antes que a sessão não pertence a outra conta.
- Sessões Android antigas só são associadas quando `/api/mobile/sessions/owned` confirma o registro no servidor; as nunca enviadas exigem atribuição explícita em Ajustes. Essa consulta não envia áudio.
- Desvincular o Android preserva os áudios e a última conta de gravação; o novo token não herda as sessões da conta anterior.

## Ordem de atualização
1. Compile backend, Android e frontend na mesma revisão.
2. Instale o Android novo com o backend antigo ainda no ar (o backend antigo ignora `owner_user_id`; o cliente antigo receberia 409 do backend novo).
3. Reinicie o backend e valide a sincronização.
4. Com duas contas de teste, confirme que áudio pendente de A não é enviado nem exibido sob B.

## Amostra de voz por conta
A referência de voz e a fila de atualização são isoladas por proprietário. O cadastro não atribui automaticamente identidade às falas; a confirmação dos participantes continua manual.

O cadastro aceita de 8 a 60 segundos de áudio decodificado, com até 25 MiB. Uma sessão existente usa os mesmos limites agregados e até 128 blocos; sessões maiores são recusadas sem cortar áudio ou substituir a referência anterior. Envie uma gravação curta nesses casos. O limite de duração é conferido durante a decodificação, antes de acumular o áudio completo. O processamento ocorre fora do event loop e aceita um cadastro por vez no processo; requisições concorrentes recebem 429 para tentar novamente. Esses limites são exclusivos do cadastro de voz e não reduzem a duração das gravações e transcrições normais.
