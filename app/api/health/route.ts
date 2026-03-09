import { runSchemaMigration } from "../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const migration = await runSchemaMigration();
  return Response.json({ ok: true, service: "leadingindicator-web", ts: new Date().toISOString(), ...migration });
}
