import {
  Entity,
  Column,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  action_type: string;

  @Column()
  actor_id: string;

  @Column({ nullable: true })
  entity_id?: string;

  @Column('jsonb', { nullable: true })
  metadata?: Record<string, any>;

  @Column({ default: '' })
  previousHash: string;

  @Column({ default: '' })
  hash: string;

  @Column({ default: '' })
  signature: string;

  @CreateDateColumn()
  timestamp: Date;
}

@Entity('audit_log_archives')
export class AuditLogArchive {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  action_type: string;

  @Column()
  actor_id: string;

  @Column({ nullable: true })
  entity_id?: string;

  @Column('jsonb', { nullable: true })
  metadata?: Record<string, any>;

  @Column({ default: '' })
  previousHash: string;

  @Column({ default: '' })
  hash: string;

  @Column({ default: '' })
  signature: string;

  @Column()
  timestamp: Date;

  @CreateDateColumn()
  archivedAt: Date;
}
