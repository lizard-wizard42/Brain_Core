# Instalação Docker local

Esta composição cria uma instância pessoal, com PostgreSQL e uploads em volumes
Docker locais. Nada é enviado para serviços externos; terminal e integrações de
memória remota começam desativados.

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
