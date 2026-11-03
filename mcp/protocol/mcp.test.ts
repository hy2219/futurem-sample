import assert from "node:assert/strict";
import { withMcp } from "./mcp.js";
import { Client, clientState, resetClients } from "../__mocks__/protocol/mcp.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => import("../__mocks__/protocol/mcp.js"));
beforeEach(resetClients);

test("MCP client helper closes its transport on success and failed operations", async () => {
  const identity = await withMcp("http://example.test/mcp", "Basic fixture", async (client) => {
    assert.ok(client instanceof Client);
    return client.identity.APP_CLIENT_ID;
  });
  const [double] = clientState.instances;
  assert.equal(identity, double.identity.APP_CLIENT_ID);
  assert.equal(double.connect.mock.calls.length, 1);
  assert.equal(double.close.mock.calls.length, 1);
  await assert.rejects(withMcp("http://example.test/mcp", "Basic fixture", async () => { throw new Error("request failed"); }), /request failed/);
  assert.equal(clientState.instances.length, 2);
  assert.equal(clientState.instances[1].close.mock.calls.length, 1);
});

test("MCP client helper closes the imported fake client after a connection failure", async () => {
  clientState.failConnect();
  await assert.rejects(withMcp("http://example.test/mcp", "Basic fixture", async () => "unreachable"), /Prepared connection failure/);
  assert.equal(clientState.instances[0].connect.mock.calls.length, 1);
  assert.equal(clientState.instances[0].close.mock.calls.length, 1);
});
