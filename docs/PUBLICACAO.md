# Preparação da cópia pública

Não transforme o repositório de trabalho diretamente em público. O histórico
atual possui objetos privados antigos, mesmo após sua remoção do estado atual.

Crie uma cópia local descartável, execute a revisão nela e somente então envie
essa cópia para um repositório GitHub novo e privado para inspeção final.

```bash
git clone --no-local . ../brain-core-publico
cd ../brain-core-publico
git filter-repo \
  --path backups \
  --path uploads \
  --path-glob '**/.env.*' \
  --path docs/private \
  --invert-paths
```

Depois, revise todos os objetos restantes e só então configure o remoto do
GitHub. A filtragem reescreve hashes; não envie força para o remoto da
instalação privada.

```bash
git log --all --name-only
git fsck --no-reflogs --unreachable
git grep -n -I -E 'PRIVATE KEY|AKIA|sk-|ghp_'
```

Use um repositório de destino novo. A escolha de licença deve ser feita antes
de qualquer publicação aberta.
