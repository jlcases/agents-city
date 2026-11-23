import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const random = (bytes: number) =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

// The README tells an operator what a capability costs in rows written, the
// unit Cloudflare bills and caps. This is where that figure comes from.
describe("what one sealed capability costs the operator", () => {
  it("is ten rows written over its life: five in the mailbox, five in the shard", async () => {
    const capability = {
      tokenHash: random(32),
      receiptTag: random(24),
      channelTag: random(24),
      expiresAt: Date.now() + 600_000,
    };
    const mailbox = await runInDurableObject(
      env.CITY_MAILBOX.getByName("acme/cost"),
      (_instance, state) => {
        const sql = state.storage.sql;
        const registered = sql.exec(
          `INSERT INTO sealed_capabilities
             (token_hash, city, channel_tag, shard_name, expires_at, created_at)
           VALUES (?, 'acme/cost', ?, 'shard', ?, ?)`,
          capability.tokenHash, capability.channelTag, capability.expiresAt, Date.now(),
        ).rowsWritten;
        const expired = sql.exec("DELETE FROM sealed_capabilities").rowsWritten;
        return { registered, expired };
      },
    );
    const shard = env.CAPABILITY_SHARD.getByName("cost");
    await shard.register("acme/cost", [capability]);
    const held = await runInDurableObject(shard, (_instance, state) => {
      const sql = state.storage.sql;
      const row = sql.exec("SELECT * FROM capabilities").one() as Record<string, SqlStorageValue>;
      sql.exec("DELETE FROM capabilities");
      const columns = Object.keys(row);
      const registered = sql.exec(
        `INSERT INTO capabilities (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})`,
        ...columns.map((column) => row[column]!),
      ).rowsWritten;
      const expired = sql.exec("DELETE FROM capabilities").rowsWritten;
      return { registered, expired };
    });
    expect(mailbox).toEqual({ registered: 4, expired: 1 });
    expect(held).toEqual({ registered: 4, expired: 1 });
  });
});
