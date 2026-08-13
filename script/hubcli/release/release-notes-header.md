## Instalação

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.sh | bash
```

**Windows (PowerShell, sem precisar de administrador)**

```powershell
irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1 | iex
```

Depois abra um terminal **novo** e rode `hubcli --version`, depois `hubcli doctor`.

Não é preciso Git nem Bun. O instalador baixa o pacote da sua plataforma, confere o
SHA-256 (veja `checksums-sha256.txt` nos anexos) e não instala nada se o checksum não bater.

Instalação offline, opções (`--check`, `--repair`, `--uninstall`) e solução de problemas:
[INSTALL](https://github.com/mkvinicius/Hubcli/blob/dev/docs/INSTALL.md) ·
[WINDOWS](https://github.com/mkvinicius/Hubcli/blob/dev/docs/WINDOWS.md) ·
[TROUBLESHOOTING](https://github.com/mkvinicius/Hubcli/blob/dev/docs/TROUBLESHOOTING.md)

---
