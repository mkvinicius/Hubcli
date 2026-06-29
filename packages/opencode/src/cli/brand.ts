const branded = !!process.env.HUBCLI_BRAND

export const SCRIPT = branded ? "hubcli" : "opencode"
export const BRAND = branded ? "HubCli" : "opencode"
