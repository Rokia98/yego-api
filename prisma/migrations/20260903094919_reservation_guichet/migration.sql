/*
  Warnings:

  - You are about to drop the column `agent_guichet_id` on the `reservations` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_agent_guichet_id_fkey";

-- AlterTable
ALTER TABLE "reservations" DROP COLUMN "agent_guichet_id",
ADD COLUMN     "agent_id" INTEGER;

-- CreateIndex
CREATE INDEX "reservations_agent_id_idx" ON "reservations"("agent_id");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "utilisateurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
