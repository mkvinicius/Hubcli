import fs from "fs/promises"
import os from "os"
import path from "path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterAll } from "bun:test"

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-core-test-data-"))
const home = path.join(dir, "home")
await fs.mkdir(home, { recursive: true })

process.env.XDG_DATA_HOME = path.join(dir, "share")
process.env.XDG_CACHE_HOME = path.join(dir, "cache")
process.env.XDG_CONFIG_HOME = path.join(dir, "config")
process.env.XDG_STATE_HOME = path.join(dir, "state")
process.env.OPENCODE_TEST_HOME = home
process.env.HOME = home
process.env.USERPROFILE = home
process.env.OPENCODE_DB = ":memory:"
process.env.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"

afterAll(async () => {
  const busy = (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "EBUSY"
  const remove = async (left: number): Promise<void> => {
    Bun.gc(true)
    await sleep(100)
    return fs.rm(dir, { recursive: true, force: true }).catch((error) => {
      if (!busy(error)) throw error
      if (left <= 1 && process.platform !== "win32") throw error
      if (left <= 1) return
      return remove(left - 1)
    })
  }

  await remove(30)
})
