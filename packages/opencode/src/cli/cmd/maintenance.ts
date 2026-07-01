/**
 * hubcli maintenance — fluxo assistido de sincronização com o upstream OpenCode.
 *
 * Registrado APENAS quando HUBCLI_BRAND=1. Delega integralmente ao script
 * shell ~/Hubcli/script/hubcli/sync-upstream.sh.
 *
 * Toda a lógica de git e segurança fica no script — este arquivo é apenas
 * um thin wrapper que torna os subcomandos acessíveis via `hubcli maintenance`.
 *
 * Subcomandos:
 *   hubcli maintenance status   — estado atual, somente leitura
 *   hubcli maintenance fetch    — git fetch upstream + origin
 *   hubcli maintenance preview  — análise de commits e conflitos potenciais
 *   hubcli maintenance sync     — merge assistido com confirmação explícita
 */

import { spawnSync } from "child_process"
import os from "os"
import path from "path"
import { cmd } from "./cmd"

const SYNC_SCRIPT = path.join(os.homedir(), "Hubcli", "script", "hubcli", "sync-upstream.sh")

function runSyncScript(subcommand: string, dryRun: boolean): void {
  if (!require("fs").existsSync(SYNC_SCRIPT)) {
    process.stderr.write(
      `hubcli maintenance: script não encontrado em ${SYNC_SCRIPT}\n` +
        `Execute o setup primeiro: bash ~/Hubcli/script/hubcli/setup.sh --check\n`,
    )
    process.exitCode = 1
    return
  }

  const args = [SYNC_SCRIPT, subcommand]
  if (dryRun) args.push("--dry-run")

  const result = spawnSync("bash", args, { stdio: "inherit" })
  process.exitCode = result.status ?? 1
}

const StatusCmd = cmd({
  command: "status",
  describe: "branch, working tree, origem, upstream e divergência (somente leitura)",
  builder: (y) => y,
  handler() {
    runSyncScript("status", false)
  },
})

const FetchCmd = cmd({
  command: "fetch",
  describe: "executar git fetch upstream + origin",
  builder: (y) =>
    y.option("dry-run", { type: "boolean", default: false, describe: "simular sem alterar" }),
  handler(args: { dryRun?: boolean }) {
    runSyncScript("fetch", !!args.dryRun)
  },
})

const PreviewCmd = cmd({
  command: "preview",
  describe: "commits novos, diff stat e conflitos potenciais (somente leitura)",
  builder: (y) => y,
  handler() {
    runSyncScript("preview", false)
  },
})

const SyncCmd = cmd({
  command: "sync",
  describe: "merge assistido com confirmação explícita (não faz rebase nem push)",
  builder: (y) =>
    y.option("dry-run", { type: "boolean", default: false, describe: "simular sem alterar" }),
  handler(args: { dryRun?: boolean }) {
    runSyncScript("sync", !!args.dryRun)
  },
})

export const MaintenanceCommand = cmd({
  command: "maintenance <subcommand>",
  describe: "manutenção do HubCli — sincronize com o upstream OpenCode",
  builder: (yargs) =>
    yargs
      .command(StatusCmd)
      .command(FetchCmd)
      .command(PreviewCmd)
      .command(SyncCmd)
      .demandCommand(1, "Informe um subcomando: status | fetch | preview | sync"),
  async handler() {},
})
