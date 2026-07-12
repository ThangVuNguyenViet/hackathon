import { buildMockPosServer } from "../src/commerce/mockPosServer.js";

const port = Number(process.env["MOCK_POS_PORT"] ?? 18110);
const token = process.env["MOCK_POS_TOKEN"] ?? "local-mock-pos-token";
const rejectItemCodes = (process.env["MOCK_POS_REJECT_ITEM_CODES"] ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const server = buildMockPosServer({ token, rejectItemCodes });
await server.listen({ host: "0.0.0.0", port });
console.log(
  JSON.stringify({
    ok: true,
    service: "mock-pos",
    simulated: true,
    url: `http://127.0.0.1:${port}`,
    rejectItemCodes,
  }),
);
