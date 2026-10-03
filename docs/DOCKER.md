# Instalação Docker local

Esta composição cria uma instância pessoal, com PostgreSQL e uploads em volumes
Docker locais. A configuração padrão não habilita envio de notas a serviços externos; terminal e Memory começam desativados. OpenAI, Telegram, imagens externas e o cliente de IA escolhido mudam os destinos dos dados quando utilizados.

## Primeiro uso

```bash
docker compose up --build -d
docker compose ps
```

Abra `http://localhost:8080`. Se o banco estiver vazio, o Brain Core mostra o
assistente de primeiro acesso para criar o administrador. Assim que a conta é
criada, a rota se fecha permanentemente e a sessão é iniciada automaticamente.
O Compose gera a senha do PostgreSQL e o segredo JWT uma única vez, em um volume
Docker local privado. Eles não aparecem no terminal nem no Git.

Para carregar três páginas inteiramente fictícias, crie `.env.docker` a partir
do exemplo e defina `SEED_DEMO_DATA=true` antes do primeiro início. Esse arquivo
também é o caminho para instalações automatizadas com `INITIAL_ADMIN_*` ou
segredos fornecidos pelo operador:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker ps
```

O assistente é protegido para aceitar somente a primeira conta, mas a porta é
ligada somente ao loopback por padrão. Não exponha esta composição HTTP na rede
local durante o primeiro acesso. Para LAN ou internet, use um
proxy TLS, `AUTH_COOKIE_SECURE=true`, uma origem CORS explícita e uma política
de proxy confiável correspondente.

O volume de uploads é local e limitado a 5 GiB por padrão. Ajuste
`UPLOADS_MAX_BYTES` no `.env.docker` somente depois de conferir o espaço livre
e a política de backup da máquina.

`INITIAL_ADMIN_*` só cria uma conta se o banco estiver vazio. O seed de demo
também só roda em banco sem páginas. Remova essas variáveis do arquivo privado
depois do primeiro início.

## Dados persistentes

- `brain-core-postgres`: banco de dados;
- `brain-core-uploads`: anexos enviados.
- `brain-core-secrets`: senha interna do banco e segredo JWT gerados para esta instalação.

Confira os volumes sem expor conteúdo:

```bash
docker volume ls --filter name=brain-core
```

Para parar sem apagar dados, use `docker compose down`.
Não use `down -v` sem um backup confirmado: ele remove os volumes persistentes.

## Atualização e diagnóstico

```bash
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker logs --tail=100 backend
curl -fsS http://localhost:8080/api/health
```


## MCP no computador do Docker

O cliente MCP inicia o adaptador no **host**, a partir de um checkout com `npm ci --prefix mcp`. A imagem do backend não contém um adaptador para ser iniciado pelo cliente externo. Nas Configurações, informe o caminho absoluto do host para `mcp/src/server.mjs` e `BRAIN_CORE_URL=http://127.0.0.1:8080` (ou a porta HTTP publicada pelo operador). O Compose fornece esse endereço como metadado `MCP_BACKEND_URL` (ajuste-o no `.env.docker` se usar uma porta web diferente por override); não publique outra porta. Salve a credencial em arquivo privado do host com modo 0600 e pasta 0700. Veja [o guia MCP](NOTES_MCP.md).

Uma conta proprietária e contas de membros compartilham a instância, com autorização por conta e compartilhamento explícito. MCP começa desligado para novas contas; cada pessoa controla suas próprias credenciais.
