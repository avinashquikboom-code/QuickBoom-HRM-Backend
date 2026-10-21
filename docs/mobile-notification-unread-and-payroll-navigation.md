# Mobile unread state, salary navigation and Socket.IO investigation

## Notification API

Flutter's `NotificationViewModel.markAsUnread` sends `PUT /api/mobile/notifications/:id/unread` and expects a successful HTTP response. The Express application already mounts `mobileNotificationRoutes` at `/api/mobile/notifications` and `/api/v1/mobile/notifications`; authentication is applied by `router.use(authenticateToken)`. Neither that router nor the other notification implementations had a mark-unread endpoint. Thus the reported `Cannot PUT` was a missing handler, rather than a wrong Flutter prefix or method.

The existing read controller now shares an implementation with the new unread controller. The single new PUT route uses existing mounting and middleware. Its write predicate includes both notification ID and authenticated `userId`. Unread writes `isRead: false, readAt: null`; read writes `isRead: true` and a timestamp. Prisma maintains the schema's automatic `updatedAt`. Other fields are untouched. Success is `{ success: true, message: 'Notification marked as unread' }`, matching Flutter's contract. Missing/invalid authentication returns 401, malformed or out-of-range IDs return 400, and nonexistent or other recipients' notifications return 404, consistent with existing recipient-scoped lookups. Existing account middleware can return 403 for inactive accounts.

The configured database is local (`localhost/quickboom_hrm`). A read-only lookup found no notification 4775 there. Its ownership in the database that produced the reported error cannot be certified from this workspace. No update to 4775 was attempted. The fix is recipient-scoped for every employee, rather than tied to an example ID.

## Salary tap navigation

This identifier format is established in `src/services/payrollService.ts` (`sendPayrollNotification`) and `src/controllers/payrollController.ts` (generation and approval notifications): `${employeeId}-${month}-${year}`. Thus `11905-10-2026` represents employee 11905 and October 2026, not a payslip primary key. The helper forwards `actionId` as `entityId`, `referenceId` and `actionId`; the mobile notification list also exposes `actionId`. The Flutter resolver reads these fields but previously discarded the identifier when opening `EmployeePayrollView`.

The existing employee payroll view already renders a selected payslip with `UnifiedSalarySlipWidget`. The destination helper now parses the established composite format and passes an initial target to that view. After fetching `/api/mobile/payroll/payslips`, the view selects the exact employee/month/year match and synchronizes the date-wise salary period. That endpoint derives the employee from the authenticated user, so push data cannot request another employee's salary. A missing/inaccessible payslip shows a message and leaves the normal view usable. Malformed/missing identifiers fall back to the existing overview. HR payroll-run notifications retain the HR overview; numeric run IDs are not treated as employee IDs. Existing notification authentication checks and Navigator flow remain in place.

## Separate Socket.IO findings

- Flutter targets `https://api.voxiqai.com`, using Socket.IO's `/socket.io/` path. The existing reverse-proxy configuration has HTTP/1.1 upgrade headers and a 3600-second read timeout for that path.
- A public polling handshake returned HTTP 200 and advertised WebSocket upgrades. A separate WebSocket request returned HTTP 101 Switching Protocols. The probe was stopped after three seconds because an upgraded connection remains open; this was not a failed handshake. These checks establish transport availability at investigation time, not that every device/network timeout is explained.
- The backend expected JWT `decoded.userId`, while application-issued tokens use `id`. It also had a different fallback signing secret. The socket middleware now uses the shared `verifyToken` and `decoded.id`, with account activity checks consistent with HTTP authentication.
- Flutter could construct additional socket clients while one was connecting/reconnecting. It now keeps one client, installs listeners before connecting, uses the parsed URL origin, explicitly enables reconnect backoff, and cancels pending initialization on disconnect.
- No Docker, reverse-proxy or other deployment configuration was changed.

## Files changed for this task

Backend:
- `src/controllers/mobile/mobileNotificationController.ts`: shared read/unread handler.
- `src/routes/mobile/mobileNotificationRoutes.ts`: authenticated PUT unread route.
- `src/services/websocketService.ts`: shared JWT verification and account checks.
- `scripts/test_mobile_notification_unread.ts`: real local database/API and WebSocket integration coverage.
- `docs/mobile-notification-unread-and-payroll-navigation.md`: investigation and validation record.

Flutter:
- `lib/core/services/notification_service.dart`: salary destination delegation.
- `lib/core/services/websocket_service.dart`: connection lifecycle and backoff.
- `lib/features/payroll/data/payroll_notification_target.dart`: composite identifier validation.
- `lib/features/payroll/presentation/screens/payroll_notification_destination.dart`: destination construction and fallback.
- `lib/features/payroll/presentation/screens/employee_payroll_view.dart`: initial payslip selection.
- `test/payroll_notification_navigation_test.dart`: parser, fallback and payslip selection tests.

Other concurrently edited notification/leave files and delivery-receipt changes were preserved and are not part of this task's change list.

## Validation results

- Backend `tsc --noEmit`: passed.
- Backend `npm run build`: passed.
- `ts-node --transpile-only scripts/test_mobile_notification_unread.ts`: passed against the local database and an isolated HTTP server using the real router/auth middleware. Covered missing/invalid authentication, cross-employee rejection, malformed IDs, nonexistent notifications, success response, repeated unread, read/unread timestamps, both API prefixes, GET response serialization and persisted database state. One temporary notification was created and deleted; no existing notification was changed.
- The same integration test exercised real WebSocket upgrade/Socket.IO authentication: an application-issued JWT was accepted; invalid JWT and nonexistent account tokens were rejected.
- `flutter analyze`: passed with no issues.
- `flutter test test/payroll_notification_navigation_test.dart`: all four tests passed. Widget tests selected October 2026 from a list with November first, and safely handled another employee's target without exposing another salary.
- Public Socket.IO polling and WebSocket transport probes: HTTP 200 and 101 respectively.

Production notification 4775 ownership and an actual system-tray tap on a device remain unverified. The code changes have not been deployed.
