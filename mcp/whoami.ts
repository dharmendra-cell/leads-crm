import "dotenv/config";
import { prisma } from "../lib/db";

const email = process.argv[2]?.toLowerCase();
prisma.user.findFirst({ where: email ? { email } : {}, include: { org: true } }).then((u) => {
  console.log(u ? `org id: ${u.orgId}  (${u.org.name}, user ${u.email})` : "No such user");
  return prisma.$disconnect();
});
