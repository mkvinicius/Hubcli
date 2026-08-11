// Logo is brand-conditional: HubCli glyphs only when HUBCLI_BRAND=1
// (injected by the ~/.local/bin/hubcli launcher). Without the flag the
// original opencode logo is preserved.

const hubcli = {
  left: ["█ █ █ █ ███ ", "█ █ █ █ █  █", "███ █ █ ███ ", "█ █ █ █ █  █", "█ █ ███ ███ "],
  right: [" ██ █   ███", "█   █    █ ", "█   █    █ ", "█   █    █ ", " ██ ███ ███"],
}

const opencode = {
  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

export const logo = process.env["HUBCLI_BRAND"] ? hubcli : opencode

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
