# Brain Core pelo Tailscale (PC e Android)

Este guia expõe o Brain Core **somente** para os seus dispositivos usando o Tailscale Serve, com uma única origem HTTPS. Não use Funnel: ele publica o serviço na internet.

## Desenho
O Serve entrega HTTPS apenas à tailnet e encaminha a um serviço local (`127.0.0.1:3001`). O próprio backend serve o frontend compilado (`FRONTEND_STATIC_DIR`) e mantém `/api`, `/uploads` e `/socket.io` na mesma origem. Assim o cookie HttpOnly e o WebSocket funcionam sem endereço de LAN embutido no bundle. O serviço de memória e o worker de transcrição continuam privados no PC; não exponha a porta 8765.

## Preparação
```bash
cd frontend && npm run build:same-origin
cd ../backend && npm run build
```
No `.env` do backend (nunca versionado):

```text
HOST=127.0.0.1
PORT=3001
FRONTEND_STATIC_DIR=/caminho/absoluto/para/brain-core/frontend/dist-same-origin
CORS_ORIGIN=https://NOME-DO-PC.NOME-DA-TAILNET.ts.net
TRUSTED_PROXIES=127.0.0.1
```
`TRUSTED_PROXIES` deve listar o proxy que fica na frente do backend (o Serve conecta por loopback); sem isso o IP do cliente e o HTTPS não são reconhecidos corretamente.

## Ativação
1. Instale o Tailscale ([guia oficial](https://tailscale.com/docs/install/linux)), faça login com `sudo tailscale up` e confirme com `tailscale status` que o celular está na mesma tailnet. Habilite os certificados HTTPS quando solicitado.
2. Reinicie somente o backend.
3. Exponha apenas ele: `tailscale serve --bg --https=443 http://127.0.0.1:3001`, e confira com `tailscale serve status`.
4. No app Android, informe a URL HTTPS em Ajustes e faça login normalmente. O app não guarda senha.

Se houver outros dispositivos na tailnet, restrinja com [grants](https://tailscale.com/docs/features/access-control/grants) quem alcança a porta 443 deste PC. Mesmo dentro da tailnet o backend exige login e autoriza cada recurso.

## Verificação
| Checagem | Esperado |
| --- | --- |
| `https://<host>/api/health` pelo celular | `200` |
| Login | Cookie de sessão HttpOnly; nenhuma senha ou token no app |
| Páginas, canvas e anexos | Abrem, salvam e exibem no WebView |
| Tailscale desligado no celular | O app informa indisponibilidade e a captura nativa continua offline |

O WebView bloqueia navegação para outra origem, arquivo local e conteúdo HTTP misto; links externos abrem no navegador.

## Reversão
`tailscale serve --https=443 off` remove o proxy sem derrubar os serviços locais. Remover `FRONTEND_STATIC_DIR` e reiniciar o backend devolve o comportamento anterior.
