import { createHash, createHmac, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { AuditLog, AuditLogArchive } from './audit.entity';

export interface AuditVerificationResult {
  valid: boolean;
  checked: number;
  errors: Array<{
    id: string;
    reason: string;
  }>;
}

type VerifiableAuditLog = Pick<
  AuditLog,
  | 'id'
  | 'action_type'
  | 'actor_id'
  | 'entity_id'
  | 'metadata'
  | 'timestamp'
  | 'previousHash'
  | 'hash'
  | 'signature'
>;

@Injectable()
export class AuditService {
  private readonly hmacKey: string;

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    @InjectRepository(AuditLogArchive)
    private readonly archiveRepo: Repository<AuditLogArchive>,
    private readonly configService: ConfigService,
  ) {
    this.hmacKey =
      this.configService.get<string>('AUDIT_LOG_HMAC_KEY') ||
      'development-audit-log-hmac-key';
  }

  async logAction(
    action_type: string,
    actor_id: string,
    entity_id?: string,
    metadata?: Record<string, any>,
  ): Promise<AuditLog> {
    return this.auditRepo.manager.transaction(async (manager) => {
      const auditRepo = manager.getRepository(AuditLog);
      const archiveRepo = manager.getRepository(AuditLogArchive);
      const latestActiveLog = await auditRepo.findOne({
        order: { timestamp: 'DESC', id: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      const latestArchivedLog = await archiveRepo.findOne({
        order: { timestamp: 'DESC', id: 'DESC' },
      });
      const latestLog = this.getLatestLog(latestActiveLog, latestArchivedLog);
      const timestamp = new Date();
      const previousHash = latestLog?.hash ?? '';
      const hash = this.computeHash(
        previousHash,
        action_type,
        actor_id,
        timestamp,
      );
      const log = auditRepo.create({
        id: randomUUID(),
        action_type,
        actor_id,
        entity_id,
        metadata,
        timestamp,
        previousHash,
        hash,
      });
      log.signature = this.computeSignature(log);

      return auditRepo.save(log);
    });
  }

  // Add this for tests
  async clearAllLogs() {
    await this.archiveRepo.clear();
    await this.auditRepo.clear();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async archiveOldLogs(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const oldLogs = await this.auditRepo.find({
      where: { timestamp: LessThan(cutoff) },
      order: { timestamp: 'ASC', id: 'ASC' },
    });

    if (oldLogs.length === 0) {
      return 0;
    }

    await this.archiveRepo.upsert(
      oldLogs.map((log) =>
        this.archiveRepo.create({
          id: log.id,
          action_type: log.action_type,
          actor_id: log.actor_id,
          entity_id: log.entity_id,
          metadata: log.metadata,
          previousHash: log.previousHash,
          hash: log.hash,
          signature: log.signature,
          timestamp: log.timestamp,
        }),
      ),
      ['id'],
    );

    await this.auditRepo.delete({ id: In(oldLogs.map((log) => log.id)) });

    return oldLogs.length;
  }

  async verifyIntegrity(): Promise<AuditVerificationResult> {
    const [archivedLogs, activeLogs] = await Promise.all([
      this.archiveRepo.find({ order: { timestamp: 'ASC', id: 'ASC' } }),
      this.auditRepo.find({ order: { timestamp: 'ASC', id: 'ASC' } }),
    ]);
    const logs = [...archivedLogs, ...activeLogs].sort((a, b) => {
      const timestampDelta =
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return timestampDelta || a.id.localeCompare(b.id);
    });

    const errors: AuditVerificationResult['errors'] = [];
    let previousHash = '';

    for (const log of logs) {
      if (log.previousHash !== previousHash) {
        errors.push({
          id: log.id,
          reason: 'previousHash does not match the previous entry hash',
        });
      }

      const expectedHash = this.computeHash(
        log.previousHash,
        log.action_type,
        log.actor_id,
        log.timestamp,
      );
      if (log.hash !== expectedHash) {
        errors.push({
          id: log.id,
          reason: 'hash does not match log contents',
        });
      }

      const expectedSignature = this.computeSignature(log);
      if (log.signature !== expectedSignature) {
        errors.push({
          id: log.id,
          reason: 'signature does not match log contents',
        });
      }

      previousHash = log.hash;
    }

    return {
      valid: errors.length === 0,
      checked: logs.length,
      errors,
    };
  }

  async getLogs(
    page = 1,
    limit = 20,
    filter?: {
      action_type?: string;
      actor_id?: string;
      entity_id?: string;
      from?: string;
      to?: string;
    },
  ): Promise<{ data: AuditLog[]; total: number }> {
    const query = this.auditRepo.createQueryBuilder('audit');

    if (filter) {
      if (filter.action_type)
        query.andWhere('audit.action_type = :action_type', {
          action_type: filter.action_type,
        });
      if (filter.actor_id)
        query.andWhere('audit.actor_id = :actor_id', {
          actor_id: filter.actor_id,
        });
      if (filter.entity_id)
        query.andWhere('audit.entity_id = :entity_id', {
          entity_id: filter.entity_id,
        });
      if (filter.from)
        query.andWhere('audit.timestamp >= :from', { from: filter.from });
      if (filter.to)
        query.andWhere('audit.timestamp <= :to', { to: filter.to });
    }

    const [data, total] = await query
      .orderBy('audit.timestamp', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total };
  }

  private getAuditHmacKey(): string {
    return this.hmacKey;
  }

  private computeHash(
    previousHash: string,
    action: string,
    userId: string,
    timestamp: Date,
  ): string {
    return createHash('sha256')
      .update(`${previousHash}${action}${userId}${this.formatTimestamp(timestamp)}`)
      .digest('hex');
  }

  private computeSignature(log: VerifiableAuditLog): string {
    return createHmac('sha256', this.getAuditHmacKey())
      .update(
        JSON.stringify({
          id: log.id ?? null,
          action_type: log.action_type,
          actor_id: log.actor_id,
          entity_id: log.entity_id ?? null,
          metadata: this.normalizeMetadata(log.metadata),
          timestamp: this.formatTimestamp(log.timestamp),
          previousHash: log.previousHash,
          hash: log.hash,
        }),
      )
      .digest('hex');
  }

  private formatTimestamp(timestamp: Date): string {
    return new Date(timestamp).toISOString();
  }

  private normalizeMetadata(metadata?: Record<string, any>): unknown {
    if (!metadata) {
      return null;
    }

    return Object.keys(metadata)
      .sort()
      .reduce<Record<string, any>>((normalized, key) => {
        normalized[key] = metadata[key];
        return normalized;
      }, {});
  }

  private getLatestLog(
    activeLog: VerifiableAuditLog | null,
    archivedLog: VerifiableAuditLog | null,
  ): VerifiableAuditLog | null {
    if (!activeLog) {
      return archivedLog;
    }

    if (!archivedLog) {
      return activeLog;
    }

    const activeTime = new Date(activeLog.timestamp).getTime();
    const archivedTime = new Date(archivedLog.timestamp).getTime();

    if (activeTime !== archivedTime) {
      return activeTime > archivedTime ? activeLog : archivedLog;
    }

    return activeLog.id > archivedLog.id ? activeLog : archivedLog;
  }
}
