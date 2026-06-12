import { prisma } from './src/utils/db';

async function checkStats() {
  const now = new Date();
  try {
    console.log('Querying count of offices and employees...');
    const totalEntities = await prisma.office.count();
    const globalSeats = await prisma.employee.count();
    console.log('totalEntities:', totalEntities, 'globalSeats:', globalSeats);

    const pendingVerification = await prisma.employee.count({
      where: { status: 'INACTIVE' },
    });
    console.log('pendingVerification:', pendingVerification);

    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const officesThisMonth = await prisma.office.count({
      where: { createdAt: { gte: startOfThisMonth } }
    });
    const officesBeforeThisMonth = await prisma.office.count({
      where: { createdAt: { lt: startOfThisMonth } }
    });
    console.log('officesThisMonth:', officesThisMonth, 'officesBeforeThisMonth:', officesBeforeThisMonth);

    const offices = await prisma.office.findMany({
      include: {
        _count: {
          select: { employees: true }
        }
      }
    });
    console.log('offices fetched:', offices.length);

    const pricingPlans = await prisma.pricingPlan.findMany();
    console.log('pricingPlans fetched:', pricingPlans.length);

    const getPlanPrices = (planName: string) => {
      const p = pricingPlans.find(pl => pl.name.toLowerCase() === planName.toLowerCase());
      return p ? { monthly: p.monthlyPrice, yearly: p.yearlyPrice } : { monthly: 1200, yearly: 12000 };
    };

    let monthlyRevenue = 0;
    offices.forEach(off => {
      const planPrices = getPlanPrices(off.subscriptionPlan);
      if (off.billingCycle === 'yearly') {
        monthlyRevenue += planPrices.yearly / 12;
      } else {
        monthlyRevenue += planPrices.monthly;
      }
    });
    if (monthlyRevenue === 0) {
      monthlyRevenue = 2400000;
    }
    console.log('monthlyRevenue:', monthlyRevenue);

    let enterpriseCount = 0;
    let proCount = 0;
    let basicCount = 0;
    offices.forEach(off => {
      const plan = off.subscriptionPlan.toLowerCase();
      if (plan === 'enterprise') enterpriseCount++;
      else if (plan === 'pro') proCount++;
      else basicCount++;
    });

    const totalOffices = offices.length || 1;
    const planMix = [
      { name: 'Enterprise', count: enterpriseCount, percent: Math.round((enterpriseCount / totalOffices) * 100), color: 'bg-primary' },
      { name: 'Pro', count: proCount, percent: Math.round((proCount / totalOffices) * 100), color: 'bg-accent' },
      { name: 'Basic', count: basicCount, percent: Math.round((basicCount / totalOffices) * 100), color: 'bg-muted' },
    ];
    console.log('planMix:', planMix);

    const recentInvoices = offices.map((off) => {
      const plan = off.subscriptionPlan;
      const planPrices = getPlanPrices(plan);
      const amountVal = off.billingCycle === 'yearly' ? planPrices.yearly : planPrices.monthly;
      const invoiceDate = new Date(off.createdAt);
      const formattedDate = invoiceDate.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
      return {
        id: `INV-2026-${(100 + off.id).toString().substring(1)}`,
        company: off.name,
        plan,
        amount: `₹${amountVal.toLocaleString('en-IN')}`,
        status: off.invoiceStatus,
        date: formattedDate
      };
    }).slice(0, 5);
    console.log('recentInvoices generated:', recentInvoices.length);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const growthHistory = [];
    const revenueHistory = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      const activeOffices = await prisma.office.findMany({
        where: { createdAt: { lte: endOfMonth } }
      });
      const companiesCount = activeOffices.length;
      const seatsCount = await prisma.employee.count({
        where: { createdAt: { lte: endOfMonth } }
      });
      growthHistory.push({
        name: monthNames[d.getMonth()],
        companies: companiesCount,
        seats: seatsCount
      });

      let monthMRR = 0;
      activeOffices.forEach(off => {
        const planPrices = getPlanPrices(off.subscriptionPlan);
        if (off.billingCycle === 'yearly') {
          monthMRR += planPrices.yearly / 12;
        } else {
          monthMRR += planPrices.monthly;
        }
      });
      const churnVal = Math.round(monthMRR * 0.05);
      revenueHistory.push({
        name: monthNames[d.getMonth()],
        value: monthMRR,
        churn: churnVal
      });
    }
    console.log('growthHistory and revenueHistory generated');

    const recentOffices = await prisma.office.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    const recentEmployees = await prisma.employee.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    const recentComments = await prisma.comment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: {
        author: {
          include: { profile: true }
        }
      }
    });
    console.log('recent offices, employees, and comments fetched');

    const formatRelativeTime = (date: Date) => {
      const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      if (seconds < 60) return 'Just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    };

    interface ActivityItem {
      id: string;
      title: string;
      description: string;
      type: 'success' | 'info' | 'warning';
      time: string;
    }
    const activities: ActivityItem[] = [];

    recentOffices.forEach(off => {
      activities.push({
        id: `office-${off.id}`,
        title: 'New company onboarded',
        description: `Company "${off.name}" was onboarded successfully.`,
        type: 'success',
        time: formatRelativeTime(off.createdAt)
      });
    });

    recentEmployees.forEach(emp => {
      activities.push({
        id: `employee-${emp.id}`,
        title: 'New employee registered',
        description: `Employee ${emp.firstName} ${emp.lastName} was registered.`,
        type: 'info',
        time: formatRelativeTime(emp.createdAt)
      });
    });

    recentComments.forEach(comm => {
      const name = comm.author.profile?.fullName || comm.author.email.split('@')[0];
      activities.push({
        id: `comment-${comm.id}`,
        title: 'Comment added',
        description: `${name} commented: "${comm.content.substring(0, 30)}${comm.content.length > 30 ? '...' : ''}"`,
        type: 'warning',
        time: formatRelativeTime(comm.createdAt)
      });
    });

    activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    const recentActivity = activities.slice(0, 5);
    console.log('recentActivity:', recentActivity);
    console.log('All stats fetch operations succeeded!');
  } catch (e: any) {
    console.error('fetchCompanyStats failed with error:', e.stack || e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

checkStats();
