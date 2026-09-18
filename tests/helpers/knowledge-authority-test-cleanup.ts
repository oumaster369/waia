import postgres from "postgres";

/**
 * Test-only cleanup: owner DELETE of Knowledge rows is blocked by DEE-771
 * append-only triggers. Disable user triggers for the duration of the delete.
 */
export async function deleteKnowledgeAuthorityRowsForOrg(
  sql: postgres.Sql,
  organizationId: string,
): Promise<void> {
  await sql.unsafe(`ALTER TABLE trader_knowledge_edge_version_v2 DISABLE TRIGGER USER`);
  await sql.unsafe(`ALTER TABLE trader_market_prediction_verification_v2 DISABLE TRIGGER USER`);
  await sql.unsafe(`ALTER TABLE trader_knowledge_edges DISABLE TRIGGER USER`);
  await sql.unsafe(`ALTER TABLE trader_market_predictions DISABLE TRIGGER USER`);
  try {
    await sql.unsafe(`DELETE FROM trader_knowledge_edge_version_v2 WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(
      `DELETE FROM trader_market_prediction_verification_v2 WHERE organization_id = $1`,
      [organizationId],
    );
    await sql.unsafe(`DELETE FROM trader_knowledge_edges WHERE organization_id = $1`, [
      organizationId,
    ]);
    await sql.unsafe(`DELETE FROM trader_market_predictions WHERE organization_id = $1`, [
      organizationId,
    ]);
  } finally {
    await sql.unsafe(`ALTER TABLE trader_market_predictions ENABLE TRIGGER USER`);
    await sql.unsafe(`ALTER TABLE trader_knowledge_edges ENABLE TRIGGER USER`);
    await sql.unsafe(`ALTER TABLE trader_market_prediction_verification_v2 ENABLE TRIGGER USER`);
    await sql.unsafe(`ALTER TABLE trader_knowledge_edge_version_v2 ENABLE TRIGGER USER`);
  }
}
