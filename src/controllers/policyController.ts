import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

const defaultPolicies = [
  {
    title: 'Workplace Attendance & Punctuality Policy',
    category: 'ATTENDANCE',
    description: 'Guidelines regarding work hours, shift timings, grace periods, and late marks.',
    content: `1. Standard Working Hours: Employees are expected to fulfill 9 working hours per day.
2. Grace Period: A 15-minute grace period is allowed for daily check-in.
3. Late Mark Rule: Accumulation of 3 late marks in a single calendar month will result in a half-day deduction from monthly pay.
4. Geo-Fencing: Punch-in must be completed within 100 meters of assigned office location or approved remote site coordinates.`,
    effectiveDate: new Date('2026-01-01'),
    status: 'ACTIVE',
  },
  {
    title: 'Annual & Sick Leave Entitlement Policy',
    category: 'LEAVE',
    description: 'Leave categories, application timelines, approval workflows, and carry-forward rules.',
    content: `1. Paid Leave Allocation: Every full-time employee is entitled to 12 Paid Leaves (PL), 6 Sick Leaves (SL), and 6 Casual Leaves (CL) annually.
2. Prior Notice: Planned leave applications must be submitted at least 3 days in advance via the HopKid Mobile App.
3. Emergency Sick Leave: Medical certificate is required for sick leave exceeding 2 consecutive working days.
4. Unplanned Leaves: Unapproved absences will be categorized as Loss of Pay (LOP).`,
    effectiveDate: new Date('2026-01-01'),
    status: 'ACTIVE',
  },
  {
    title: 'Salary Deduction & LOP Regulations',
    category: 'DEDUCTION',
    description: 'Overview of statutory deductions (PF, ESIC, PT) and Loss of Pay (LOP) calculations.',
    content: `1. Statutory Deductions: Employee Provident Fund (12% of basic) and ESIC (0.75% of gross) are deducted automatically as per statutory norms.
2. LOP Calculation: Daily rate is calculated as (Base Salary / 26). LOP is deducted for unapproved absences.
3. Advance Payback: Salary advance EMI is deducted directly from monthly payslip as per agreed schedule.`,
    effectiveDate: new Date('2026-01-01'),
    status: 'ACTIVE',
  },
  {
    title: 'Company Code of Conduct & Ethics',
    category: 'CONDUCT',
    description: 'Behavioral standards, confidentiality, professional ethics, and data security.',
    content: `1. Professional Conduct: Employees must maintain professional demeanor, treat colleagues with respect, and adhere to non-discrimination principles.
2. Confidentiality: Customer and proprietary company data must remain strictly confidential.
3. Device Usage: Company issued credentials must not be shared or used for unauthorized third-party activities.`,
    effectiveDate: new Date('2026-01-01'),
    status: 'ACTIVE',
  },
];

export const getCompanyPolicies = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { type, category, search } = req.query as { type?: string; category?: string; search?: string };

    const count = await prisma.companyPolicy.count();
    if (count === 0) {
      await prisma.companyPolicy.createMany({
        data: defaultPolicies,
      });
    }

    const targetCategory = (type || category || '').toUpperCase();
    const where: any = { status: 'ACTIVE' };

    if (targetCategory && targetCategory !== 'ALL') {
      where.category = targetCategory;
    }

    if (search && search.trim() !== '') {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    const policies = await prisma.companyPolicy.findMany({
      where,
      orderBy: { effectiveDate: 'desc' },
    });

    res.json({
      success: true,
      policies,
    });
  } catch (error) {
    console.error('Get company policies error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch company policies.' });
  }
};
