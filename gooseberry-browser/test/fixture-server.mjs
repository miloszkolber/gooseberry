import { startServer } from "../src/server.mjs";

const encoded = process.argv[2];
if (!encoded) throw new Error("test server options are required");
await startServer(JSON.parse(encoded));
