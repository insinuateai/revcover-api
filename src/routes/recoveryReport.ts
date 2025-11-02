import type { FastifyPluginAsync } from "fastify";

type Deps = {
  repo: { getRecoveryReport: (orgId: string) => Promise<Buffer> };
};

export const buildRecoveryReportRoute =
  ({ repo }: Deps): FastifyPluginAsync =>
  async (app) => {
    // Test hits /recovery-report/demo-org.pdf
    app.get<{ Params: { orgId: string } }>(
      "/recovery-report/:orgId.pdf",
      async (req, reply) => {
        const { orgId } = req.params;
        const pdf = await repo.getRecoveryReport(orgId); // must be a Buffer
        reply.type("application/pdf").send(pdf);
      }
    );
  };

export default buildRecoveryReportRoute;
