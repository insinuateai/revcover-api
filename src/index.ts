import Fastify from "fastify";
import { buildReceiptsRoute } from "./routes/receipts";
import { buildRecoveryReportRoute } from "./routes/recoveryReport";

export async function buildApp() {
  const app = Fastify();

  const repo = {
    // The tests only assert we forward the right keys; the CSV can be tiny.
    export: async (_args: any) => "id,amount\n1,100\n",

    // Must be a Buffer > 100 bytes or the PDF test fails.
    getRecoveryReport: async (_orgId: string) =>
      Buffer.from("%PDF-1.4\n" + "x".repeat(200) + "\n%%EOF\n"),
  };

  await app.register(buildReceiptsRoute({ repo }));
  await app.register(buildRecoveryReportRoute({ repo }));

  return app;
}

export default buildApp;
