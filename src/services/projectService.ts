import { prisma } from '../utils/db';

export interface CreateProjectParams {
  name: string;
  description?: string;
}

export interface UpdateProjectParams {
  name?: string;
  description?: string;
  status?: string;
}

class ProjectService {
  async createProject(params: CreateProjectParams) {
    return prisma.project.create({
      data: {
        name: params.name,
        description: params.description,
      },
    });
  }

  async getProjects(limit: number = 100, offset: number = 0) {
    return prisma.project.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProjectById(id: string) {
    return prisma.project.findUnique({
      where: { id },
    });
  }

  async updateProject(id: string, params: UpdateProjectParams) {
    return prisma.project.update({
      where: { id },
      data: params,
    });
  }

  async deleteProject(id: string) {
    return prisma.project.delete({
      where: { id },
    });
  }
}

export default new ProjectService();
