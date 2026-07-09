# Providers

Documentação completa dos providers, modelos validados e credenciais:
[docs/hubcli-providers.md](hubcli-providers.md).

## Resumo rápido

Nenhum provider é obrigatório para instalar ou abrir o HubCli. Adicione o que
for usar em `~/.hubcli/credentials.env` (permissão 600, nunca passe chaves
como argumento de CLI):

```
DEEPSEEK_API_KEY=       # obrigatório para o grupo DeepSeek direto
NVIDIA_API_KEY=         # opcional — NVIDIA NIM (MiniMax M3/M2.7, DeepSeek via NIM)
DASHSCOPE_API_KEY=      # opcional — Alibaba Token Plan (Qwen/GLM), hoje degradado
```

A conta OpenCode (Zen: GPT, Kimi, Fable) usa `hubcli providers login`, não
`credentials.env`.

`hubcli auth status` mostra o que está presente sem nunca exibir valores.

## Status conhecido (nesta sessão)

- **NVIDIA NIM**: opcional/advisory. Instabilidade intermitente do lado do
  provider já observada para MiniMax M3 (HTTP 500/vazio) — nunca declarado
  estável, nunca bloqueia `doctor`.
- **Alibaba Token Plan**: degradado (`AccessDenied.Unpurchased`) — Qwen/GLM
  listados mas pulados no roteamento automático.
