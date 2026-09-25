# Arquitetura

```text
Navegador
    │ HTTP, WebSocket
    ▼
Web (Nginx) ────────────────► Backend (Express + Socket.IO)
    │                                  │
    │                                  ├── PostgreSQL (volume local)
    │                                  └── uploads (volume local)
    ▼
Interface React
```

Na composição Docker, apenas o serviço web recebe uma porta do host, limitada a
`127.0.0.1:8080`. PostgreSQL e backend comunicam-se pela rede interna do Docker.

O backend aplica alterações aditivas ao esquema ao iniciar. Em banco vazio, o
administrador inicial e os dados de demonstração só são criados quando suas
variáveis privadas correspondentes forem fornecidas.

## Limites deliberados

- Esta edição é uma instância pessoal, não uma plataforma multiusuário.
- O terminal fica desligado por padrão e não deve ser exposto publicamente.
- IA, Telegram e a integração experimental de gravação não são necessários para editar, organizar ou armazenar notas.
- Backups precisam ser configurados pela pessoa que hospeda a instância.
