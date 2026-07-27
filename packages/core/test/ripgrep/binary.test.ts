import { describe, expect, test } from "bun:test"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"

describe("RipgrepBinary", () => {
  test("maps every supported host to the official release asset", () => {
    expect(RipgrepBinary.asset("x64", "win32")).toMatchObject({
      platform: "x86_64-pc-windows-msvc",
      extension: "zip",
    })
    expect(RipgrepBinary.asset("arm64", "win32")).toMatchObject({
      platform: "aarch64-pc-windows-msvc",
      extension: "zip",
    })
    expect(RipgrepBinary.asset("ia32", "win32")).toMatchObject({
      platform: "i686-pc-windows-msvc",
      extension: "zip",
    })
    expect(RipgrepBinary.asset("x64", "darwin")).toMatchObject({
      platform: "x86_64-apple-darwin",
      extension: "tar.gz",
    })
    expect(RipgrepBinary.asset("arm64", "darwin")).toMatchObject({
      platform: "aarch64-apple-darwin",
      extension: "tar.gz",
    })
    expect(RipgrepBinary.asset("x64", "linux")).toMatchObject({
      platform: "x86_64-unknown-linux-musl",
      extension: "tar.gz",
    })
    expect(RipgrepBinary.asset("arm64", "linux")).toMatchObject({
      platform: "aarch64-unknown-linux-gnu",
      extension: "tar.gz",
    })
    expect(RipgrepBinary.asset("s390x", "linux")).toBeUndefined()
  })

  test("accepts complete bytes only when their SHA-256 matches", () => {
    const complete = new TextEncoder().encode("complete archive fixture")
    const expected = RipgrepBinary.checksum(complete)
    const partial = complete.slice(0, 8)

    expect(RipgrepBinary.checksumMatches(complete, expected)).toBe(true)
    expect(RipgrepBinary.checksumMatches(partial, expected)).toBe(false)
    expect(RipgrepBinary.checksumMatches(new Uint8Array(), expected)).toBe(false)
  })

  test("ships a 64-character lowercase SHA-256 for every asset", () => {
    for (const item of Object.values(RipgrepBinary.PLATFORM)) {
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})
