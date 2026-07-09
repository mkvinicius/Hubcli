# Instalar em VPS Linux

**Status: pendente de validação real.** Nesta sessão não havia acesso a uma
VPS real (Ubuntu 22.04/24.04 x64) — o artefato `hubcli-linux-x64.tar.gz` foi
construído por cross-compilação a partir de macOS e nunca executado em Linux
de verdade. O que segue é o procedimento esperado, não um resultado
verificado.

## Procedimento esperado

```bash
ssh user@vps
curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/main/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"   # se o instalador avisar que não está no PATH
hubcli --version
hubcli doctor
```

Sem GUI: TUI (`hubcli`), `hubcli run`, `hubcli serve`, `hubcli mcp serve` e
`hubcli doctor` devem funcionar normalmente por SSH — nenhum deles depende de
display gráfico. Isso é esperado do design (mesmo mecanismo do OpenCode
original, que já roda em servidores headless), mas **não foi confirmado
nesta sessão**.

## Checklist de validação pendente (para quando houver acesso a VPS real)

- [ ] `install.sh` numa VPS Ubuntu 22.04 x64 limpa, sem Git/Bun pré-instalados
- [ ] `install.sh` numa VPS Ubuntu 24.04 x64 limpa
- [ ] `hubcli` (TUI) por SSH
- [ ] `hubcli run`
- [ ] `hubcli mcp serve` (handshake real)
- [ ] `hubcli serve` (modo headless/servidor)
- [ ] `hubcli profile` / `hubcli doctor`
- [ ] `install.sh --repair` (upgrade sem Git)
- [ ] `install.sh --uninstall`

Até essa checklist ser executada de verdade, **não declare Linux "testado em
produção"** — apenas "construído e validado localmente via cross-compile
com smoke test do build.ts", que é o que de fato aconteceu.
