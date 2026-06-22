# VoxiqAI Engineering Standards

## Mission

You are working within the VoxiqAI ecosystem.

Current products may include:

* VoxiqAI HRM
* VoxiqAI Attendance
* VoxiqAI Payroll
* VoxiqAI ERP
* Future VoxiqAI Products

Your goal is to build scalable, secure, enterprise-grade software while maintaining full backward compatibility.

---

# Core Principles

* Never break existing functionality.
* Never introduce breaking API changes.
* Never rename existing database tables or columns without approval.
* Never remove existing endpoints.
* Never remove existing business logic.
* Always maintain backward compatibility.
* Prefer extension over replacement.
* Reuse existing code whenever possible.

---

# Technology Stack

Backend

* Node.js
* Express.js
* TypeScript
* Prisma ORM
* PostgreSQL

Admin Panel

* Next.js
* TypeScript
* Tailwind CSS

Mobile App

* Flutter
* Clean Architecture
* Riverpod
* Dio
* shared_preferences

---

# Clean Architecture (Mandatory)

Backend:

Route
→ Controller
→ Service
→ Model
→ Prisma
→ PostgreSQL

Rules:

* Routes contain routing only.
* Controllers handle requests/responses.
* Services contain business logic.
* Models contain database access.
* Prisma handles queries only.

Never place:

* SQL/Prisma queries in controllers.
* Business logic in routes.
* API logic in models.

---

# Flutter Clean Architecture

Every feature must follow:

features/
├── presentation/
├── domain/
└── data/

Presentation

* Screens
* Widgets
* Providers

Domain

* Entities
* Repositories
* Use Cases

Data

* Models
* Data Sources
* Repository Implementations

---

# Folder Separation Rules

Always create separate:

* Routes
* Controllers
* Services
* Models
* DTOs
* Validators
* Providers
* Widgets
* Components
* Repositories
* Data Sources

Avoid large files.

Split reusable functionality.

---

# Widget & Component Rules

Every reusable UI must be extracted.

Examples:

* DashboardCard
* EmployeeCard
* AttendanceCard
* LeaveCard
* PayrollCard
* NotificationCard
* StoreCard
* ShiftCard

Never place large UI blocks directly inside screens.

---

# Theme Rules

Never hardcode:

* Colors
* Font sizes
* Spacing
* Border radius

Use centralized theme files.

---

# Dynamic Data Policy

Strictly prohibited:

* Hardcoded employees
* Hardcoded roles
* Hardcoded companies
* Hardcoded dashboard stats
* Mock attendance data
* Fake payroll data
* Temporary arrays

All business data must come from:

PostgreSQL
→ Prisma
→ API
→ Frontend

No static production data.

---

# Authentication Standards

Use:

* JWT Access Tokens
* Refresh Tokens

Required:

* Token Rotation
* Secure Logout
* Session Management
* Device Tracking

Never expose:

* Passwords
* JWT Secrets
* Refresh Tokens
* Database Credentials

---

# Mobile Security

Store securely:

* Access Token
* Refresh Token
* User ID
* Employee ID
* Company ID
* Branch ID
* Role
* Permissions

Use:

shared_preferences

---

# API Standards

Every protected API must validate:

* Authentication
* Authorization
* Role Access
* Permission Access
* Company Access
* Branch Access

Never trust frontend data.

---

# Audit Logging

Track:

* Login
* Logout
* Attendance Punch In
* Attendance Punch Out
* Leave Approval
* Leave Rejection
* Payroll Generation
* User Updates
* Employee Updates
* Role Updates
* Permission Changes

Store:

* User ID
* Branch ID
* IP Address
* Device
* Timestamp
* Action

---

# Multi Store Structure

Company
→ Head Office
→ Branches / Stores

Roles:

* SUPER_ADMIN
* HR_MANAGER
* STORE_MANAGER
* SALESMAN
* HELPER

Access Rules:

SUPER_ADMIN

* Full access

HR_MANAGER

* Company-wide access

STORE_MANAGER

* Assigned store only

SALESMAN

* Own records only

HELPER

* Own records only

---

# Shift Management

Support:

* Morning Shift
* Evening Shift
* Night Shift
* On Field Shift

Attendance must be linked with:

Employee
→ Branch
→ Shift

On-field employees require GPS attendance support.

---

# Compliance & Security

Design systems following principles aligned with:

* ISO 27001
* ISO 9001
* ISO 22301
* SOC 2
* GDPR
* OWASP Top 10

Implement:

* Audit Logs
* Access Controls
* Backup Support
* Recovery Planning
* Data Export Capability

---

# Production Readiness Checklist

Before marking any task complete:

✓ No hardcoded data

✓ No mock data

✓ API integrated

✓ Error handling implemented

✓ Loading states implemented

✓ Empty states implemented

✓ Permission validation implemented

✓ Audit logging implemented

✓ Responsive UI implemented

✓ Secure storage implemented

✓ Build passes

✓ Existing functionality still works

✓ No regressions introduced

---

# Final Rule

All implementations must be:

* Production Ready
* Scalable
* Secure
* Reusable
* Maintainable
* Backward Compatible

No shortcuts.
No temporary fixes.
No mock implementations.
No breaking changes.
