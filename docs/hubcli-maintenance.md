# Manutenção do fork (sync com upstream OpenCode)

O HubCli roda direto do código-fonte em `~/Hubcli`. `hubcli upgrade` é bloqueado (o atualizador de binário do OpenCode não se aplica) e aponta para o fluxo assistido:

```bash
hubcli maintenance status    # branch, working tree, remotes, commits ahead/behind (somente leitura)
hubcli maintenance fetch     # git fetch upstream + origin (nada além disso)
hubcli maintenance preview   # commits novos, diff stat, arquivos com risco de conflito
hubcli maintenance sync      # merge assistido
hubcli maintenance sync --dry-run
```

## Garantias do sync

- Exige working tree **limpa** (nunca faz stash automático) e a branch correta.
- Cria branch de backup `backup/hubcli-before-upstream-<timestamp>` antes do merge.
- Usa `git merge --no-ff upstream/dev` — **nunca** rebase, reset --hard, push --force ou clean.
- Para no primeiro conflito e instrui a resolução manual; nunca resolve sozinho.
- Pede confirmação explícita antes do merge e antes de `bun install`.
- `credentials.env` nunca é copiada nem lida.

## Fluxo recomendado

1. `hubcli maintenance status` → tree limpa?
2. `hubcli maintenance fetch`
3. `hubcli maintenance preview` → conflitos aceitáveis?
4. Opcional: `git merge-tree --write-tree HEAD upstream/dev` — se imprimir só um OID, o merge é limpo.
5. `hubcli maintenance sync`
6. Pós-merge: `bun install`, typechecks (`bun run --filter opencode typecheck`, `--filter @opencode-ai/tui`), testes hubcli, `hubcli doctor --all`.

## Arquivos sensíveis em merges

Mudanças HubCli concentram-se em: `src/cli/brand.ts`, `src/cli/hubcli/*`, `src/cli/cmd/{doctor,maintenance}.ts` (novos) e patches pequenos em `src/index.ts`, `src/cli/cmd/{run,mcp,upgrade,tui}.ts` e `packages/tui/src/{app.tsx,hubcli/*}`. Em conflito, preserve o gate `HUBCLI_BRAND`/`BRAND === "HubCli"` e o comportamento original sem a flag.
