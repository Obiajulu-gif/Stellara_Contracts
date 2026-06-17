import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditLog, AuditLogArchive } from './audit.entity';
import { AuditListener } from './audit.listener';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, AuditLogArchive])],
  providers: [AuditService, AuditListener],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
