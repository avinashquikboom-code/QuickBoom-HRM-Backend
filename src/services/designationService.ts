import { prisma } from '../utils/db';

class DesignationService {
  async getDesignations() {
    return prisma.designation.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async getDesignationById(id: string) {
    return prisma.designation.findUnique({
      where: { id },
    });
  }

  async createDesignation(name: string) {
    const normalized = name.trim();
    return prisma.designation.create({
      data: { name: normalized },
    });
  }

  async updateDesignation(id: string, name: string, isActive?: boolean) {
    const data: any = { name: name.trim() };
    if (isActive !== undefined) {
      data.isActive = isActive;
    }
    return prisma.designation.update({
      where: { id },
      data,
    });
  }

  async deleteDesignation(id: string) {
    return prisma.designation.delete({
      where: { id },
    });
  }
}

export default new DesignationService();
