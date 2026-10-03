# Backup do Brain Core

## Escopo

O formato 2 inclui PostgreSQL (páginas, contas, históricos e integrações), Markdown, anexos e, quando presente, a Memory: SQLite e os arquivos de áudio referenciados que ainda não foram expurgados.

Os snapshots ficam em `backups/brain-core/` com acesso restrito (`0700`). Cada um contém `database.dump`, `files/`, `manifest.json` e, quando habilitada, `memory/`. O link `latest` aponta para o último snapshot concluído. Dependências, código-fonte e arquivos de configuração secreta não são copiados. Preserve separadamente as configurações privadas necessárias à recuperação da instalação.

PostgreSQL é exportado por `pg_dump` a partir da mesma transação usada para contar os registros. Markdown e anexos são copiados com `rsync --checksum`; arquivos idênticos podem compartilhar hard links entre snapshots. O manifesto guarda hashes dos arquivos. A retenção padrão é 14 snapshots concluídos.

A Memory deve estar sem writers durante a cópia: API, GPU worker e relabel. `scripts/run-complete-backup.sh` pausa as unidades user-systemd ativas e as inicia novamente ao terminar, inclusive em falhas. Um lock impede backups simultâneos. Não execute durante gravação: há uma breve indisponibilidade da Memory. Uploads e importações também devem ficar sem alterações durante um backup/recuperação que precise de consistência entre arquivos e PostgreSQL.

## Fontes efetivas

O script carrega `backend/.env` sem substituir variáveis já exportadas. Uploads usam `UPLOADS_DIR` ou `backend/uploads`, como o backend nativo. Memory usa `BRAIN_MEMORY_DIR`/`BRAIN_MEMORY_DB` quando fornecidos; na ausência deles, usa `CELTWO_MEMORY_DATA_DIR`/`CELTWO_MEMORY_DB_PATH`, depois `data/memory/memory.db`. Um `private-data/memory.env` separado não é carregado automaticamente pelo backup: configure ou exporte os caminhos reais. Markdown usa `MD_SOURCE_PATH`. Caminhos relativos de uploads/Markdown são resolvidos a partir de `backend/`; caminhos Memory relativos usam a raiz do projeto, como os templates nativos. Prefira caminhos absolutos ao configurar uma instalação.

Se uma fonte obrigatória de arquivos não existe, a execução falha; não escolhe automaticamente outra pasta com o mesmo nome. O manifesto registra as fontes copiadas e se Memory foi incluída. Em Docker, `/app/uploads` e `/data/memory` são caminhos dos contêineres: disponibilize os volumes ao processo de backup e mapeie esses caminhos explicitamente. O script nativo não descobre volumes Docker sozinho.

## Execução e agendamento user-systemd

```bash
bash scripts/run-complete-backup.sh
```

Os exemplos de unidades assumem instalação em `%h/apps/brain-core`; ajuste ambos os caminhos da unidade antes de instalar em outro local:

```bash
mkdir -p "$HOME/.config/systemd/user"
cp deploy/systemd/brain-core-backup-user.service.example "$HOME/.config/systemd/user/brain-core-backup-user.service"
cp deploy/systemd/brain-core-backup-user.timer.example "$HOME/.config/systemd/user/brain-core-backup-user.timer"
systemctl --user daemon-reload
systemctl --user enable --now brain-core-backup-user.timer
systemctl --user list-timers brain-core-backup-user.timer
journalctl --user -u brain-core-backup-user.service -n 30 --no-pager
```

O timer agenda diariamente às 03:35 no fuso do sistema, com atraso aleatório de até 10 minutos. `Persistent=true` recupera uma execução perdida quando o user manager iniciar. Para funcionar sem sessão aberta, esse manager precisa permanecer ativo (`linger`). Não habilite simultaneamente outro timer para o mesmo backup.

Instalações com unidades de sistema ou containers devem pausar os writers por sua própria operação e usar `BRAIN_MEMORY_QUIESCED=true node scripts/backup-brain-core.mjs`. Essa variável declara que a parada já ocorreu; ela não interrompe serviços. A execução direta recusa uma Memory presente sem essa declaração. Uma instalação sem o SQLite no caminho efetivo configurado continua fazendo o backup de PostgreSQL e arquivos.

## Ensaio de restauração

```bash
node scripts/verify-complete-backup.mjs backups/brain-core/latest
```

Requer os binários PostgreSQL encontrados por `pg_config --bindir`. O ensaio cria um cluster temporário com socket Unix e sem porta TCP, restaura o dump com `--exit-on-error`, compara as contagens, confere anexos e hashes dos arquivos e verifica uma cópia restaurada da Memory. O cluster e a cópia são removidos ao terminar. Nenhum conteúdo de nota ou transcrição é impresso.

## Recuperação real

Pare o backend, importações, a Memory e seus workers. Preserve o estado atual em outro backup. Restaure PostgreSQL em um banco novo primeiro; só depois reconfigure a instalação para usá-lo. Copie `files/markdown` e `files/uploads` para os destinos apropriados, sem `--delete` automático.

Para a Memory, copie **todo** o diretório `memory/` do snapshot para uma localização vazia de recuperação e execute:

```bash
python3 scripts/snapshot-memory.py --restore-paths /private/recovery/memory
```

Esse comando valida integridade, contagens e hashes e substitui as referências portáveis do SQLite por caminhos absolutos **na cópia restaurada**. Nunca o execute no snapshot original. Configure `CELTWO_MEMORY_DATA_DIR` e `CELTWO_MEMORY_DB_PATH` da Memory para esse destino antes de iniciar API/workers. O ensaio não muda o banco em uso.

## Retenção e limites

`BRAIN_BACKUP_DIR` altera o destino, e `BRAIN_BACKUP_RETENTION` aceita de 1 a 365 snapshots. `BRAIN_PROJECT_ROOT`, `BRAIN_MEMORY_DIR` e `BRAIN_MEMORY_DB` permitem indicar explicitamente os diretórios da instalação. `BRAIN_MEMORY_PYTHON` seleciona o Python para a cópia SQLite (somente biblioteca padrão).

O snapshot só é publicado após todas as etapas concluírem. Falhas removem o diretório parcial e retornam erro. Hard links entre snapshots não devem ser editados diretamente.

O backup permanece no mesmo computador. Uma cópia criptografada fora dele protege contra perda física do disco; essa replicação depende da escolha de outro destino e não faz parte deste timer.
