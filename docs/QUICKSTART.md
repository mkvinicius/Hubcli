# Início rápido

```bash
curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/main/install.sh | bash

hubcli --version
hubcli doctor            # providers ausentes aparecem como WARN, nunca crash
hubcli auth status        # mostra quais credenciais existem (nunca os valores)
```

Nenhum provider é obrigatório para abrir o HubCli. Para usar modelos, edite:

```bash
nano ~/.hubcli/credentials.env   # DEEPSEEK_API_KEY=, NVIDIA_API_KEY=, DASHSCOPE_API_KEY=
chmod 600 ~/.hubcli/credentials.env
hubcli providers login            # conta OpenCode (Zen: GPT, Kimi, Fable)
```

Depois:

```bash
hubcli run "Olá"                        # modelo padrão
hubcli profile list                     # coding | fast | reasoning | review | long-context
hubcli run --profile coding "..."       # roteamento por perfil
```

Próximos passos: [docs/PROVIDERS.md](PROVIDERS.md), [docs/hubcli-profiles.md](hubcli-profiles.md), [docs/hubcli-mcp.md](hubcli-mcp.md).
