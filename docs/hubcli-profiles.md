# Perfis e roteamento

Perfis são listas ordenadas de modelos com roteamento **determinístico e inspecionável** — sem "IA escolhendo IA".

## Comandos

```bash
hubcli profile list            # todos os perfis (+ atual)
hubcli profile show coding     # modelos em ordem de prioridade
hubcli profile use coding      # define o perfil atual (não muda o modelo padrão)
hubcli profile current
hubcli run --profile coding "..."
hubcli run --profile coding --no-fallback "..."   # sempre o 1º modelo
hubcli route explain --profile coding             # decisão passo a passo
```

## Perfis iniciais

| Perfil | Ordem |
|---|---|
| coding | gpt-5.2-codex → kimi-k2.7-code → minimax-m3 (NVIDIA) → deepseek-v4-pro |
| fast | deepseek-v4-flash → kimi-k2.5 → minimax-m2.7 (NVIDIA) |
| reasoning | gpt-5.2 → deepseek-v4-pro → deepseek-v4-pro (NVIDIA) |
| review | deepseek-v4-pro → gpt-5.2 → gpt-5.2-codex |
| long-context | minimax-m3 (1M) → deepseek-v4-pro (1M) → gpt-5.2 (400k) → fable-5 (1M, experimental) |

## Regras de fallback (seleção, nunca runtime)

Ao resolver `--profile`, um modelo é **pulado** (com motivo registrado) quando:
- o provider está em `degraded_providers` (ex.: alibaba-token-plan);
- a credencial do provider está ausente (`DEEPSEEK_API_KEY` etc.; opencode = auth.json);
- é experimental e ainda existem modelos não experimentais na lista.

Nunca há retry em runtime: se o modelo escolhido falhar durante a sessão, o erro aparece normalmente (limitação documentada — refazer a sessão com outro modelo é decisão sua). Nunca há fallback por erro de prompt, recusa de segurança ou resposta ruim.

## Persistência

`~/.hubcli/profiles.json` — schema versionado (`version: 1`), backup automático `*.bak-<timestamp>` a cada gravação, validação rigorosa (modelo desconhecido → arquivo rejeitado → defaults seguros com aviso). O arquivo nunca entra no repositório.
