# Segurança

HubCli é um fork independente do [OpenCode](https://github.com/anomalyco/opencode).
O motor é o mesmo, então o modelo de ameaça abaixo é herdado — mas o canal de
reporte é outro.

## Modelo de ameaça

### Sem sandbox

HubCli **não** isola o agente. O sistema de permissões existe para você
acompanhar o que o agente está fazendo (ele pede confirmação antes de rodar
comandos, escrever arquivos, etc.), mas **não é um mecanismo de isolamento de
segurança**.

Se você precisa de isolamento real, rode o HubCli dentro de um contêiner ou VM.

### Modo servidor

O modo servidor é opt-in. Ao habilitar, defina `OPENCODE_SERVER_PASSWORD` para
exigir HTTP Basic Auth. Sem isso, o servidor roda sem autenticação (com aviso).
Proteger o servidor é responsabilidade de quem o habilita.

### Credenciais

Chaves ficam em `~/.hubcli/credentials.env` (permissão 600 obrigatória no
macOS/Linux) ou no auth nativo do OpenCode. O launcher usa um parser
whitelist — nunca `source` nem `eval` — e nenhum comando do HubCli imprime
valores de credencial (`doctor` e `auth status` mostram apenas presença).

### Fora de escopo

| Categoria | Motivo |
|---|---|
| Acesso ao servidor quando você o habilitou | é o comportamento esperado do modo servidor |
| "Escape de sandbox" | não existe sandbox (ver acima) |
| Tratamento de dados pelo provider de LLM | governado pela política do provider que você configurou |
| Comportamento de servidores MCP externos | MCP servers que você configura estão fora da fronteira de confiança |
| Arquivos de config maliciosos | você controla sua própria config |

## Reportando uma vulnerabilidade

**No HubCli** (instaladores, empacotamento, launcher, `doctor`, perfis,
servidor MCP do HubCli): use a aba
[Security Advisory do HubCli](https://github.com/mkvinicius/Hubcli/security/advisories/new).

**No OpenCode** (núcleo do agente, ferramentas, TUI, providers): reporte
diretamente em
[OpenCode Security Advisories](https://github.com/anomalyco/opencode/security/advisories/new)
— o HubCli herda a correção via sync com o upstream.

Se não tiver certeza de onde o problema está, reporte no HubCli; é fácil
encaminhar.

Este é um projeto mantido por uma pessoa só, no tempo livre — não há SLA de
resposta. Não abra issue pública para vulnerabilidade.

## Segurança da distribuição

Como os binários são construídos, assinados (ou não), verificados por checksum
e o que isso garante ou não: [docs/SECURITY.md](docs/SECURITY.md).
