# Backup do Brain Core

## Escopo

O backup diário protege os três conjuntos de dados que não podem ser reconstruídos apenas pelo Git:

- PostgreSQL `brain_core_db`, em formato custom do `pg_dump`;
- páginas em `data/markdown/` (ou no caminho definido por `MD_SOURCE_PATH`);
- anexos em `uploads/`.

Código-fonte, dependências, builds e segredos de `backend/.env` não são copiados. O código está no Git e as credenciais devem continuar fora dos arquivos de backup.

Os snapshots ficam em `backups/brain-core/`, com permissão `0700`. Cada snapshot possui `database.dump`, `files/` e `manifest.json`. O link `latest` aponta para o snapshot mais recente.

Arquivos que não mudaram são reaproveitados por hard links com `rsync --link-dest`. Assim, cada snapshot parece completo para restauração, mas não duplica anexos idênticos no disco. A retenção padrão é de 14 snapshots concluídos.

## Agendamento instalado

O timer de sistema `brain-core-backup.timer` executa diariamente às 03:35, com atraso aleatório de até 15 minutos. `Persistent=true` faz uma execução perdida acontecer quando o computador voltar a ligar.

Instalação ou atualização das unidades:

```bash
sudo install -d -o brain-core -g brain-core -m 0700 /opt/brain-core/backups/brain-core
sudo install -m 0644 deploy/systemd/brain-core-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/brain-core-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now brain-core-backup.timer
sudo systemctl start brain-core-backup.service
```

## Verificação operacional

```bash
systemctl status brain-core-backup.timer --no-pager
systemctl status brain-core-backup.service --no-pager
journalctl -u brain-core-backup.service -n 100 --no-pager
readlink -f /opt/brain-core/backups/brain-core/latest
pg_restore --list /opt/brain-core/backups/brain-core/latest/database.dump >/dev/null
```

O serviço só publica o snapshot depois que `pg_dump`, `pg_restore --list` e as cópias de arquivos terminam. Uma falha remove o diretório parcial e retorna código diferente de zero.

## Restauração segura

Nunca restaure automaticamente sobre `brain_core_db`. Primeiro valide em um banco separado e mantenha o Brain Core parado durante uma restauração real.

Exemplo de ensaio em banco isolado:

```bash
sudo -u postgres createdb brain_core_restore_check
sudo -u postgres pg_restore --no-owner --no-privileges \
  --dbname brain_core_restore_check \
  /opt/brain-core/backups/brain-core/latest/database.dump
```

As páginas e anexos ficam dentro de `latest/files/`. Restaure esses diretórios somente depois de comparar o snapshot com os dados atuais; não use cópia com `--delete` durante uma recuperação sem revisão humana.

Ao terminar o ensaio:

```bash
sudo -u postgres dropdb brain_core_restore_check
```

## Retenção e capacidade

A retenção pode ser alterada com `BRAIN_BACKUP_RETENTION`, limitada entre 1 e 365 snapshots. O valor padrão de 14 equilibra histórico e espaço local. Excluir um snapshot antigo não quebra os demais hard links.

Este backup permanece no mesmo computador. Para proteção contra perda física do SSD, deve existir também uma cópia criptografada em outro equipamento ou armazenamento externo; essa replicação não faz parte deste timer.
