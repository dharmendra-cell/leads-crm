-- CreateTable
CREATE TABLE "RankingConfig" (
    "orgId" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingConfig_pkey" PRIMARY KEY ("orgId")
);

-- AddForeignKey
ALTER TABLE "RankingConfig" ADD CONSTRAINT "RankingConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
