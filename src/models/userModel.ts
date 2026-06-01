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

export const findUserById = async (id: string | number) => {
  const parsedId = typeof id === "string" ? parseInt(id, 10) : id;
  return await prisma.user.findUnique({
    where: { id: parsedId },
    include: {
      profile: true,
      employee: true,
      userPermission: true,
    },
  });
};