import { prisma } from "../utils/db";

export const findUserByEmail = async (email: string) => {
  return await prisma.user.findUnique({
    where: { email },
    include: {
      profile: true,
      employee: true,
      userPermission: true,
    },
  });
};

export const findUserById = async (id: string) => {
  return await prisma.user.findUnique({
    where: { id },
    include: {
      profile: true,
      employee: true,
      userPermission: true,
    },
  });
};