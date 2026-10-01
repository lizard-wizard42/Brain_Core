# Isolamento de gravações por conta

Cobre o áudio capturado pelo navegador e pelo Android. Os demais pontos de isolamento multiusuário precisam de validação própria antes de liberar uma segunda conta real.

## Regra de propriedade
- Uma gravação nova recebe o ID da conta no início da captura (IndexedDB no navegador; `sessions.owner_user_id` no SQLite do Android).
- O navegador só envia, conclui e recupera sessões da conta autenticada naquele momento; a API confere `owner_user_id` contra o usuário da sessão HTTP antes de aceitar áudio. Trocar de login durante a permissão do microfone cancela o início.
- Rotas de gravação validam UUIDs completos (8-4-4-4-12).
- O Android mantém o token do dispositivo fixo durante cada execução do worker e só envia sessões do mesmo proprietário; a API confere `owner_user_id` contra o dono do token. Trocar de conta interrompe o lote em andamento.
- A captura nativa exige uma conta previamente vinculada, inclusive offline.

## Migração sem atribuição silenciosa
- Sessões antigas do navegador sem proprietário ficam no IndexedDB; o usuário pode atribuí-las explicitamente à conta atual, e o servidor confirma antes que a sessão não pertence a outra conta.
- Sessões Android antigas só são associadas quando `/api/mobile/sessions/owned` confirma o registro no servidor; as nunca enviadas exigem atribuição explícita em Ajustes. Essa consulta não envia áudio.
- Desvincular o Android preserva os áudios e a última conta de gravação; o novo token não herda as sessões da conta anterior.

## Ordem de atualização
1. Compile backend, Android e frontend na mesma revisão.
2. Instale o Android novo com o backend antigo ainda no ar (o backend antigo ignora `owner_user_id`; o cliente antigo receberia 409 do backend novo).
3. Reinicie o backend e valide a sincronização.
4. Com duas contas de teste, confirme que áudio pendente de A não é enviado nem exibido sob B.

## Limite em aberto
O serviço de memória guarda uma voiceprint global e o worker a aplica a todos os jobs. A gravação é isolada, mas a identificação de "minha voz" ainda não é multiusuário. Antes de habilitar duas contas reais, escope a voiceprint por conta e transmita o proprietário ao worker, ou desative essa classificação compartilhada.
