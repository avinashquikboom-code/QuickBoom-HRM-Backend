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
* Secure password hashing using the project's security service (`hashPassword`) for all user accounts, including bootstrapping/default profiles.

Never expose:

* Passwords
* JWT Secrets
* Refresh Tokens
* Database Credentials

Never use:

* Hardcoded or plain-text default passwords in code or database during user creation/bootstrapping (both in Admin Panel and Backend). Always generate a secure random temporary password and hash it before saving.

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

---

# Common Issues & Debugging Rules

Before changing code, always identify the root cause.

Never assume the problem is authentication, tokens, Prisma, Flutter, or database without verification.

=================================================
API ERROR DEBUGGING
===================

Status Code Guide

200

* Success

400

* Validation Error

401

* Authentication Error
* Invalid Token
* Missing Token
* Expired Token

403

* Authorization Error
* Permission Denied
* Role Restriction

404

* Resource Not Found

409

* Duplicate Data

422

* Business Logic Error

429

* Rate Limit

500

* Backend Error
* Database Error
* Prisma Error
* Service Error
* Null Reference Error
* Relation Error

=================================================
500 ERROR INVESTIGATION
=======================

If API returns:

500 Internal Server Error

Do NOT assume token issue.

Check:

1. Backend Logs
2. Service Layer
3. Prisma Queries
4. Database Relations
5. Missing Tables
6. Missing Columns
7. Null Values
8. Aggregation Queries
9. Dashboard Calculations

Always log the actual exception.

Bad:

catch(error){
throw new Error("Something went wrong");
}

Good:

catch(error){
console.error(error);
throw error;
}

=================================================
AUTHENTICATION DEBUGGING
========================

If API returns:

401 Unauthorized

Check:

* Access Token
* Refresh Token
* Token Expiration
* Authorization Header
* Secure Storage
* Session Records

Example:

Authorization:
Bearer <access_token>

=================================================
AUTHORIZATION DEBUGGING
=======================

If API returns:

403 Forbidden

Check:

* User Role
* Permissions
* Company Access
* Branch Access

Example:

Store Manager
cannot access
Store 2 data
if assigned to
Store 1

=================================================
PRISMA DEBUGGING
================

Before modifying schema:

Verify:

* Model Names
* Relation Names
* Foreign Keys
* Nullable Fields
* Enum Values

Common Errors:

Relation does not exist

Column does not exist

Table does not exist

Unknown argument

Invalid include

Missing foreign key

=================================================
DATABASE DEBUGGING
==================

Verify:

* Tables exist
* Columns exist
* Foreign keys exist
* Relations exist
* Seed data exists

Never assume database contains data.

Check counts first.

=================================================
SUPER ADMIN DASHBOARD DEBUGGING
===============================

If dashboard API fails:

Check:

* Company Count Query
* Employee Count Query
* Attendance Summary Query
* Payroll Summary Query
* Store Summary Query

Most dashboard failures are caused by:

* Missing relation
* Null value
* Empty database
* Prisma query error

=================================================
NEXT.JS DEBUGGING
=================

Slow Page Load

Check:

* Multiple API Calls
* Sequential Requests
* Missing Loading States
* Large Queries
* Server Components

Dashboard should not take:

30+ seconds

Target:

Under 3 seconds

=================================================
FLUTTER DEBUGGING
=================

Build Failure

Check:

* Flutter Version
* Gradle Version
* Kotlin Version
* Android SDK
* Java Version

Before changing code run:

flutter clean

flutter pub get

flutter doctor

=================================================
GRADLE DEBUGGING
================

If error contains:

NoSuchFileException

Check:

Gradle Cache Corruption

Actions:

Delete:

~/.gradle/caches

android/.gradle

build

Run:

flutter clean

flutter pub get

=================================================
API INTEGRATION DEBUGGING
=========================

Before blaming backend:

Check:

* API URL
* Environment Variables
* Authorization Header
* Request Body
* Query Parameters

Verify API using Postman.

=================================================
PRODUCTION DEBUGGING RULE

Before implementing a fix:

1. Reproduce issue.
2. Identify root cause.
3. Verify logs.
4. Verify database.
5. Verify API response.
6. Verify frontend request.
7. Implement fix.
8. Test regression.
9. Verify existing functionality still works.

Never implement blind fixes.

Never guess.

Always verify root cause first.

