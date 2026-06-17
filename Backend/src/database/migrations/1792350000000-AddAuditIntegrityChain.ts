import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditIntegrityChain1792350000000
  implements MigrationInterface
{
  name = 'AddAuditIntegrityChain1792350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "previousHash" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "hash" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "signature" character varying NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_timestamp_id" ON "audit_logs" ("timestamp", "id")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "audit_log_archives" (
        "id" uuid NOT NULL,
        "action_type" character varying NOT NULL,
        "actor_id" character varying NOT NULL,
        "entity_id" character varying,
        "metadata" jsonb,
        "previousHash" character varying NOT NULL DEFAULT '',
        "hash" character varying NOT NULL DEFAULT '',
        "signature" character varying NOT NULL DEFAULT '',
        "timestamp" TIMESTAMP NOT NULL,
        "archivedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log_archives_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_log_archives_timestamp_id" ON "audit_log_archives" ("timestamp", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_audit_log_archives_timestamp_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log_archives"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_audit_logs_timestamp_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "signature"`,
    );
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "hash"`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "previousHash"`,
    );
  }
}
