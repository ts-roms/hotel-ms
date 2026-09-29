import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { HrAccess } from './hr-access.js';
import { AttendanceService } from './time/attendance.service.js';
import { ClockPhotosController } from './time/clock-photos.controller.js';
import { LeaveController } from './time/leave.controller.js';
import { LeaveService } from './time/leave.service.js';
import { MeController } from './time/me.controller.js';
import { PayrollService } from './time/payroll.service.js';
import { PhotoRetentionController } from './time/photo-retention.controller.js';
import { PropertyHrController } from './time/property-hr.controller.js';
import { ScheduleService } from './time/schedule.service.js';
import { StaffingController } from './time/staffing.controller.js';
import { StaffingService } from './time/staffing.service.js';
import { TimeClockService } from './time/time-clock.service.js';
import { BirthdaysController } from './workforce/birthdays.controller.js';
import { DocumentRetentionController } from './workforce/document-retention.controller.js';
import { EmployeeDocumentsController } from './workforce/employee-documents.controller.js';
import { EmployeeDocumentsService } from './workforce/employee-documents.service.js';
import { EmployeeRecordsController } from './workforce/employee-records.controller.js';
import { HrController } from './workforce/hr.controller.js';
import { PeopleService } from './workforce/people.service.js';
import { ProfileRecordsService } from './workforce/profile-records.service.js';

/**
 * HR (blueprint §6.1, §13): Workforce (workforce/: employees, departments, documents,
 * records) and Time (time/: attendance, time clock, scheduling, staffing, leave, payroll
 * export). One Nest module; the two sub-folders share hr-access.ts and do not import each
 * other (ADR-0031).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    HrController,
    LeaveController,
    EmployeeDocumentsController,
    DocumentRetentionController,
    ClockPhotosController,
    PhotoRetentionController,
    MeController,
    EmployeeRecordsController,
    StaffingController,
    PropertyHrController,
    BirthdaysController,
  ],
  providers: [
    HrAccess,
    PeopleService,
    EmployeeDocumentsService,
    ProfileRecordsService,
    AttendanceService,
    TimeClockService,
    ScheduleService,
    StaffingService,
    LeaveService,
    PayrollService,
  ],
  exports: [
    HrAccess,
    AttendanceService,
    TimeClockService,
    LeaveService,
    EmployeeDocumentsService,
    ProfileRecordsService,
  ],
})
export class HrModule {}
