-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "remarkPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Lead_orgId_remarkPending_idx" ON "Lead"("orgId", "remarkPending");
