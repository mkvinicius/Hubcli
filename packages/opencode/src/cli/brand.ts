const branded = !!process.env.HUBCLI_BRAND

export const HUBCLI_BRAND = branded
export const SCRIPT = branded ? "hubcli" : "opencode"
export const BRAND = branded ? "HubCli" : "opencode"
