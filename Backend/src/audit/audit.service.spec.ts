import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditLog, AuditLogArchive } from './audit.entity';

describe('AuditService', () => {
  let service: AuditService;
  let auditLogs: AuditLog[];
  let archivedLogs: AuditLogArchive[];
  let queryBuilder: Record<string, jest.Mock>;
  let auditRepoMock: any;
  let archiveRepoMock: any;

  const buildRepo = <T extends { id: string; timestamp?: Date }>(
    rows: T[],
  ) => ({
    manager: { transaction: jest.fn() },
    create: jest.fn((entity) => entity),
    save: jest.fn(async (entity) => {
      rows.push(entity as T);
      return entity;
    }),
    clear: jest.fn(async () => {
      rows.splice(0, rows.length);
    }),
    findOne: jest.fn(async () => {
      return (
        [...rows].sort((a, b) => {
          const timestampDelta =
            new Date(b.timestamp ?? 0).getTime() -
            new Date(a.timestamp ?? 0).getTime();
          return timestampDelta || b.id.localeCompare(a.id);
        })[0] ?? null
      );
    }),
    find: jest.fn(async () =>
      [...rows].sort((a, b) => {
        const timestampDelta =
          new Date(a.timestamp ?? 0).getTime() -
          new Date(b.timestamp ?? 0).getTime();
        return timestampDelta || a.id.localeCompare(b.id);
      }),
    ),
    upsert: jest.fn(async (entities) => {
      rows.push(...(entities as T[]));
    }),
    delete: jest.fn(async () => undefined),
    createQueryBuilder: jest.fn(() => queryBuilder),
  });

  beforeEach(async () => {
    auditLogs = [];
    archivedLogs = [];
    queryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };
    auditRepoMock = buildRepo(auditLogs);
    archiveRepoMock = buildRepo(archivedLogs);
    auditRepoMock.manager.transaction.mockImplementation((callback) =>
      callback({
        getRepository: jest.fn((entity) =>
          entity === AuditLog ? auditRepoMock : archiveRepoMock,
        ),
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: auditRepoMock,
        },
        {
          provide: getRepositoryToken(AuditLogArchive),
          useValue: archiveRepoMock,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'test-audit-hmac-key') },
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should log an action', async () => {
    const result = await service.logAction('USER_CREATED', 'user1', 'entity1', {
      key: 'value',
    });

    expect(result).toMatchObject({
      action_type: 'USER_CREATED',
      actor_id: 'user1',
      entity_id: 'entity1',
      metadata: { key: 'value' },
      previousHash: '',
    });
    expect(result.hash).toHaveLength(64);
    expect(result.signature).toHaveLength(64);
  });

  it('should get logs with pagination', async () => {
    const logs = [{ id: '1' }];
    queryBuilder.getManyAndCount.mockResolvedValue([logs, 1]);

    const result = await service.getLogs(1, 20, {});

    expect(result).toEqual({ data: logs, total: 1 });
  });

  it('should fail integrity verification when a log entry is modified', async () => {
    await service.logAction('USER_CREATED', 'user1', 'entity1', {
      key: 'value',
    });
    await service.logAction('USER_UPDATED', 'user1', 'entity1', {
      key: 'new-value',
    });

    await expect(service.verifyIntegrity()).resolves.toMatchObject({
      valid: true,
      checked: 2,
      errors: [],
    });

    auditLogs[0].action_type = 'USER_DELETED';

    const result = await service.verifyIntegrity();

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: auditLogs[0].id,
          reason: 'hash does not match log contents',
        }),
        expect.objectContaining({
          id: auditLogs[0].id,
          reason: 'signature does not match log contents',
        }),
      ]),
    );
  });
});
