# Windows

## Instalação

Abra o **PowerShell** (não precisa ser como administrador) e rode:

```powershell
irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1 | iex
```

Para passar opções — `| iex` sozinho não repassa parâmetros — use:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1))) -Check
```

Alternativa mais segura (baixar, ler e só então executar):

```powershell
irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1 -OutFile install.ps1
notepad install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

O instalador baixa `hubcli-windows-x64.zip` (~95 MB), confere o SHA-256, instala em
`%USERPROFILE%\.hubcli\bin`, roda um smoke test e oferece adicionar essa pasta ao seu PATH.
Nada é instalado se o checksum não bater.

## Requisitos

- Windows 64-bit (x64). **Windows ARM64 ainda não tem pacote** — o instalador avisa e para.
- Windows PowerShell 5.1 (o que já vem no Windows) ou PowerShell 7+. Ambos funcionam.
- Não precisa de Git, Bun, Node ou permissão de administrador.

## O que o pacote contém

| Arquivo | Papel |
|---|---|
| `hubcli.cmd` | ponto de entrada — é o que você chama no terminal |
| `hubcli.ps1` | launcher: carrega credenciais e chama o runtime |
| `hubcli-runtime.exe` | binário completo (TUI, run, doctor, MCP) |
| `hubcli-fast.exe` | binário auxiliar para comandos rápidos |

Config e credenciais ficam em `%USERPROFILE%\.hubcli\` (`opencode.json`,
`credentials.env`, `profiles.json`) — o mesmo padrão do `~/.hubcli` no macOS/Linux.

Diferente do launcher POSIX, o do Windows **não tem fallback para código-fonte**: o pacote
distribuído não inclui TypeScript nem Bun, então `HUBCLI_DEV` não é lido.

## Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| `hubcli` não é reconhecido | a pasta não está no PATH ainda. Abra um terminal **novo**, ou rode `$env:Path += ";$env:USERPROFILE\.hubcli\bin"` na sessão atual |
| Download parece travar | já corrigido — o instalador desliga a barra de progresso do PowerShell, que tornava downloads grandes absurdamente lentos no PS 5.1 |
| `Could not create SSL/TLS secure channel` | já corrigido — o instalador força TLS 1.2. Se ainda ocorrer, sua rede provavelmente tem proxy/inspeção TLS; baixe o `.zip` manualmente da página de releases |
| `Unsupported architecture: x86` | era um bug (lia a arquitetura do *processo*, não do sistema) — corrigido. Atualize para a versão mais recente do instalador |
| SmartScreen/antivírus bloqueia | o instalador roda `Unblock-File` nos arquivos. Binários não são assinados digitalmente ainda, então alguns antivírus corporativos podem barrar — nesse caso peça liberação ao TI |
| Rede corporativa bloqueia `raw.githubusercontent.com` | baixe `install.ps1` e o `.zip` por outro caminho e use `-Version` + `$env:HUBCLI_INSTALL_SOURCE` apontando para a pasta local |

## Instalação offline / atrás de proxy restritivo

Se a máquina não alcança o GitHub diretamente, baixe em outra máquina:

- `hubcli-windows-x64.zip`
- `checksums-sha256.txt`

de https://github.com/mkvinicius/Hubcli/releases, coloque os dois na mesma pasta, e então:

```powershell
$env:HUBCLI_INSTALL_SOURCE = "C:\caminho\para\a\pasta"
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/mkvinicius/Hubcli/dev/install.ps1)))
```

O checksum continua sendo verificado normalmente.

## Estado da validação

O workflow `hubcli-ci.yml` roda, em runner `windows-latest` real, a cada push:

- build e empacotamento do `hubcli-windows-x64.zip`;
- `verify-package`: extrai o pacote num runner **sem checkout do repositório** e executa
  `--version`, `--help`, `profile list`, `doctor`, `doctor --mcp`;
- `verify-installer`: executa o **`install.ps1` de verdade** — instalação limpa, `-Check`,
  `-Repair` (verificando que credenciais do usuário sobrevivem), checksum inválido
  (verificando que nada é instalado) e `-Uninstall` (verificando que dados são preservados).

O que **ainda não** foi feito: nenhuma pessoa rodou o instalador numa máquina Windows
física fora do CI, e os binários não são assinados digitalmente. Se você testar num
Windows real e algo falhar, abra uma issue com a mensagem de erro exata.
