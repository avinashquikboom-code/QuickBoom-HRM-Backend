import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'QuickBoom HRM API',
      version: '1.0.0',
      description: 'Comprehensive HR Management System API documentation',
      contact: {
        name: 'QuickBoom Support',
        email: 'support@quickboom.com',
      },
    },
    servers: [
      {
        url: 'https://quickboom-hrm-backend.onrender.com',
        description: 'Production server',
      },
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authentication token',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            role: {
              type: 'string',
              enum: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE', 'PLATFORM_ADMIN']
            },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Employee: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string' },
            department: { type: 'string' },
            position: { type: 'string' },
            joinDate: { type: 'string', format: 'date' },
            salary: { type: 'number' },
            officeId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'] },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        Office: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            address: { type: 'string' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            radius: { type: 'number' },
            timezone: { type: 'string' },
            workingHours: {
              type: 'object',
              properties: {
                start: { type: 'string' },
                end: { type: 'string' },
              },
            },
          },
        },
        Attendance: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            date: { type: 'string', format: 'date' },
            checkIn: { type: 'string', format: 'date-time' },
            checkOut: { type: 'string', format: 'date-time' },
            breakStart: { type: 'string', format: 'date-time' },
            breakEnd: { type: 'string', format: 'date-time' },
            totalHours: { type: 'number' },
            status: {
              type: 'string',
              enum: ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE']
            },
            location: {
              type: 'object',
              properties: {
                latitude: { type: 'number' },
                longitude: { type: 'number' },
              },
            },
          },
        },
        Leave: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            type: {
              type: 'string',
              enum: ['SICK', 'CASUAL', 'ANNUAL', 'MATERNITY', 'PATERNITY', 'UNPAID']
            },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            reason: { type: 'string' },
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
            approvedBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Payroll: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            month: { type: 'string' },
            year: { type: 'number' },
            basicSalary: { type: 'number' },
            allowances: { type: 'number' },
            deductions: { type: 'number' },
            netSalary: { type: 'number' },
            status: { type: 'string', enum: ['PENDING', 'PROCESSED', 'PAID'] },
            processedDate: { type: 'string', format: 'date-time' },
          },
        },
        Notification: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            message: { type: 'string' },
            type: {
              type: 'string',
              enum: ['INFO', 'WARNING', 'ERROR', 'SUCCESS', 'LEAVE', 'PAYROLL', 'ATTENDANCE']
            },
            isRead: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Expense: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            employeeId: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            amount: { type: 'number' },
            category: {
              type: 'string',
              enum: ['TRAVEL', 'MEAL', 'ACCOMMODATION', 'OFFICE', 'MEDICAL', 'OTHER']
            },
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
            receiptUrl: { type: 'string' },
            submittedDate: { type: 'string', format: 'date' },
          },
        },
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            assignedTo: { type: 'string', format: 'uuid' },
            assignedBy: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] },
            priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
            dueDate: { type: 'string', format: 'date' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object' },
            error: { type: 'string' },
          },
        },
        ServiceHealth: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string', enum: ['healthy', 'unhealthy', 'degraded'] },
            responseTime: { type: 'number' },
            error: { type: 'string' },
            details: { type: 'object' },
          },
        },
        SystemHealth: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            arch: { type: 'string' },
            nodeVersion: { type: 'string' },
            memory: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                free: { type: 'number' },
                used: { type: 'number' },
                percentage: { type: 'number' },
              },
            },
            cpu: {
              type: 'object',
              properties: {
                cores: { type: 'number' },
                loadAverage: { type: 'array', items: { type: 'number' } },
                percentage: { type: 'number' },
              },
            },
            disk: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                free: { type: 'number' },
                used: { type: 'number' },
                percentage: { type: 'number' },
              },
            },
          },
        },
        HealthMetrics: {
          type: 'object',
          properties: {
            activeConnections: { type: 'number' },
            requestsPerMinute: { type: 'number' },
            errorRate: { type: 'number' },
            averageResponseTime: { type: 'number' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
          },
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'role'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: {
              type: 'string',
              enum: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE', 'PLATFORM_ADMIN']
            },
            departmentId: { type: 'integer' },
            officeId: { type: 'integer' },
            designation: { type: 'string' },
          },
        },
        CreateEmployeeRequest: {
          type: 'object',
          required: ['email', 'name', 'department', 'position'],
          properties: {
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            department: { type: 'string' },
            position: { type: 'string' },
            salary: { type: 'number' },
            joinDate: { type: 'string', format: 'date' },
            officeId: { type: 'string', format: 'uuid' },
          },
        },
        CreateOfficeRequest: {
          type: 'object',
          required: ['name', 'address', 'latitude', 'longitude'],
          properties: {
            name: { type: 'string' },
            address: { type: 'string' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            radius: { type: 'number' },
            timezone: { type: 'string' },
            workingHours: {
              type: 'object',
              properties: {
                start: { type: 'string' },
                end: { type: 'string' },
              },
            },
          },
        },
        ApplyLeaveRequest: {
          type: 'object',
          required: ['type', 'startDate', 'endDate', 'reason'],
          properties: {
            type: {
              type: 'string',
              enum: ['SICK', 'CASUAL', 'ANNUAL', 'MATERNITY', 'PATERNITY', 'UNPAID']
            },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            reason: { type: 'string' },
          },
        },
        CreateExpenseRequest: {
          type: 'object',
          required: ['title', 'amount', 'category'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            amount: { type: 'number' },
            category: {
              type: 'string',
              enum: ['TRAVEL', 'MEAL', 'ACCOMMODATION', 'OFFICE', 'MEDICAL', 'OTHER']
            },
            receiptUrl: { type: 'string' },
          },
        },
        LeaveBalanceRequest: {
          type: 'object',
          required: ['employeeId'],
          properties: {
            employeeId: { type: 'integer' },
            departmentId: { type: 'integer' },
            fiscalYear: { type: 'string' },
            casualTotal: { type: 'integer' },
            sickTotal: { type: 'integer' },
            earnedTotal: { type: 'integer' },
          },
        },
        LeaveBalanceResponse: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            employeeId: { type: 'integer' },
            fiscalYear: { type: 'string' },
            casualTotal: { type: 'integer' },
            casualUsed: { type: 'integer' },
            casualRemaining: { type: 'integer' },
            sickTotal: { type: 'integer' },
            sickUsed: { type: 'integer' },
            sickRemaining: { type: 'integer' },
            earnedTotal: { type: 'integer' },
            earnedUsed: { type: 'integer' },
            earnedRemaining: { type: 'integer' },
            totalRemaining: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        BulkLeaveAllocationRequest: {
          type: 'object',
          required: ['allocations'],
          properties: {
            allocations: {
              type: 'array',
              items: { $ref: '#/components/schemas/LeaveBalanceRequest' }
            },
          },
        },
        ComprehensiveAttendanceReport: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                period: {
                  type: 'object',
                  properties: {
                    month: { type: 'integer' },
                    year: { type: 'integer' },
                    startDate: { type: 'string', format: 'date' },
                    endDate: { type: 'string', format: 'date' },
                    totalDays: { type: 'integer' }
                  }
                },
                summary: {
                  type: 'object',
                  properties: {
                    totalDays: { type: 'integer' },
                    presentDays: { type: 'integer' },
                    absentDays: { type: 'integer' },
                    leaveDays: { type: 'integer' },
                    fullDays: { type: 'integer' },
                    halfDays: { type: 'integer' },
                    averageWorkHours: { type: 'number' },
                    averageBreakTime: { type: 'number' },
                    locationTrackingCompliance: { type: 'number' },
                    attendancePercentage: { type: 'number' },
                    punctualityRate: { type: 'number' }
                  }
                },
                attendanceRecords: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/AttendanceRecord' }
                },
                locationTracking: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/LocationTracking' }
                },
                breakDetails: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/BreakDetail' }
                },
                metrics: {
                  type: 'object',
                  properties: {
                    totalEmployees: { type: 'integer' },
                    totalRecords: { type: 'integer' },
                    averageWorkHours: { type: 'number' },
                    averageBreakTime: { type: 'number' },
                    locationTrackingCompliance: { type: 'number' }
                  }
                }
              }
            }
          }
        },
        AttendanceRecord: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            employeeId: { type: 'integer' },
            date: { type: 'string', format: 'date' },
            checkIn: { type: 'string', format: 'date-time' },
            checkOut: { type: 'string', format: 'date-time' },
            status: { type: 'string' },
            attendanceType: { type: 'string', enum: ['FULL_DAY', 'HALF_DAY', 'ABSENT', 'LEAVE'] },
            totalWorkSeconds: { type: 'number' },
            totalBreakSeconds: { type: 'number' },
            hasLocation: { type: 'integer' },
            employeeCode: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            departmentName: { type: 'string' }
          }
        },
        LocationTracking: {
          type: 'object',
          properties: {
            employeeId: { type: 'integer' },
            date: { type: 'string', format: 'date' },
            checkIn: { type: 'string', format: 'date-time' },
            checkOut: { type: 'string', format: 'date-time' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            locationUpdates: { type: 'integer' },
            locationStatus: { type: 'string', enum: ['IN_OFFICE', 'OUT_OF_OFFICE'] }
          }
        },
        BreakDetail: {
          type: 'object',
          properties: {
            employeeId: { type: 'integer' },
            date: { type: 'string', format: 'date' },
            breakStartTime: { type: 'string', format: 'date-time' },
            totalBreakSeconds: { type: 'number' },
            breakMinutes: { type: 'number' },
            breakType: { type: 'string', enum: ['SHORT_BREAK', 'STANDARD_BREAK', 'LONG_BREAK', 'NO_BREAK'] },
            firstName: { type: 'string' },
            lastName: { type: 'string' }
          }
        },
        AttendanceTrends: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                period: { type: 'string' },
                monthsAnalyzed: { type: 'integer' },
                trends: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      month: { type: 'string', format: 'date-time' },
                      totalRecords: { type: 'integer' },
                      presentDays: { type: 'integer' },
                      absentDays: { type: 'integer' },
                      leaveDays: { type: 'integer' },
                      completeDays: { type: 'integer' },
                      averageWorkHours: { type: 'number' },
                      averageBreakTime: { type: 'number' },
                      locationTrackingCompliance: { type: 'number' },
                      uniqueEmployees: { type: 'integer' }
                    }
                  }
                }
              }
            }
          }
        },
        LocationTrackingReport: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                period: {
                  type: 'object',
                  properties: {
                    startDate: { type: 'string', format: 'date' },
                    endDate: { type: 'string', format: 'date' }
                  }
                },
                statistics: {
                  type: 'object',
                  properties: {
                    totalRecords: { type: 'integer' },
                    trackedRecords: { type: 'integer' },
                    officeCompliantRecords: { type: 'integer' },
                    averageDistance: { type: 'number' },
                    locationTrackingPercentage: { type: 'number' },
                    officeCompliancePercentage: { type: 'number' }
                  }
                },
                locationRecords: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/LocationRecord' }
                },
                insights: {
                  type: 'object',
                  properties: {
                    trackingCompliance: { type: 'number' },
                    officeCompliance: { type: 'number' },
                    averageDistanceFromOffice: { type: 'number' }
                  }
                }
              }
            }
          }
        },
        LocationRecord: {
          type: 'object',
          properties: {
            employeeId: { type: 'integer' },
            date: { type: 'string', format: 'date' },
            checkIn: { type: 'string', format: 'date-time' },
            checkOut: { type: 'string', format: 'date-time' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            status: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            employeeCode: { type: 'string' },
            officeName: { type: 'string' },
            distanceFromOffice: { type: 'number' },
            locationStatus: { type: 'string', enum: ['TRACKED', 'NOT_TRACKED'] },
            officeCompliance: { type: 'string', enum: ['IN_OFFICE_AREA', 'OUTSIDE_OFFICE_AREA'] }
          }
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/**/*.ts', './src/controllers/**/*.ts'],
};

export const specs = swaggerJsdoc(options);
