# Segurança de borda

## O que o backend aplica
- As respostas de `/api/*` incluem `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site` e `Cache-Control: no-store`. `/uploads` mantém cabeçalhos próprios porque a pré-visualização de PDF usa iframe.
- `/api/*` tem um limitador por IP (`API_RATE_LIMIT_PER_MINUTE`, padrão 1200; responde 429 com `Retry-After`). O login mantém limites mais rígidos por IP e por conta.
- Corpos JSON são limitados a 256 KB, exceto `/api/pages`, `/api/remember` e `/api/mobile` (10 MB, para documentos e snapshots de canvas).
- O IP do cliente vem de `req.ip`, configurado por `TRUSTED_PROXIES`. `X-Forwarded-For` nunca é interpretado manualmente: a entrada mais à esquerda é controlada pelo cliente.
- HSTS só é enviado em requisições HTTPS e `X-Powered-By` é removido.

## O que o servidor do frontend estático deve acrescentar
Se o frontend é servido por nginx, `FRONTEND_STATIC_DIR` ou outro host, use cabeçalhos como:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: microphone=(self), camera=()
```

tldraw e TipTap injetam estilos inline, por isso `style-src 'unsafe-inline'`. Comece com `Content-Security-Policy-Report-Only` e valide antes de aplicar.

## Dados pessoais (LGPD)
- **Acesso e portabilidade (art. 18):** `GET /api/auth/export` (Ajustes → "Seus dados") devolve páginas, notas rápidas, contatos e compartilhamentos recebidos em JSON. Credenciais, tokens de integração e áudio ficam de fora.
- **Trilha de auditoria:** `account.export` e `recording.transcript.read` são registrados como eventos estruturados com usuário e sessão.
- **Já existente:** isolamento de gravações por conta, retenção de áudio configurável e exclusão de voiceprint.
- Voz e voiceprint são dados biométricos sensíveis (art. 5º II e art. 11): o cadastro deve ser sempre uma ação explícita do usuário e nunca usar a voz de outra pessoa sem consentimento.
