import { prisma } from '../utils/db';

export interface CreateAssetParams {
  name: string;
  code: string;
  type: string;
}

export interface UpdateAssetParams {
  name?: string;
  type?: string;
  status?: string;
  employeeId?: string | null;
  assignedDate?: Date | null;
}

class AssetService {
  async createAsset(params: CreateAssetParams) {
    return prisma.asset.create({
      data: {
        name: params.name,
        code: params.code,
        type: params.type,
      },
    });
  }

  async getAssets(limit: number = 100, offset: number = 0) {
    return prisma.asset.findMany({
      include: { employee: true },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAssetById(id: string) {
    return prisma.asset.findUnique({
      where: { id },
      include: { employee: true },
    });
  }

  async updateAsset(id: string, params: UpdateAssetParams) {
    return prisma.asset.update({
      where: { id },
      data: params,
    });
  }

  async deleteAsset(id: string) {
    return prisma.asset.delete({
      where: { id },
    });
  }

  async assignAsset(id: string, employeeId: string) {
    return prisma.asset.update({
      where: { id },
      data: {
        employeeId,
        status: 'ASSIGNED',
        assignedDate: new Date(),
      },
    });
  }

  async returnAsset(id: string) {
    return prisma.asset.update({
      where: { id },
      data: {
        employeeId: null,
        status: 'AVAILABLE',
        assignedDate: null,
      },
    });
  }
}

export default new AssetService();
