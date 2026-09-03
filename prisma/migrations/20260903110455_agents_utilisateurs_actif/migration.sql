/*
  Warnings:

  - You are about to drop the `agents_guichet` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "agents_guichet" DROP CONSTRAINT "agents_guichet_compagnie_id_fkey";

-- AlterTable
ALTER TABLE "utilisateurs" ADD COLUMN     "actif" BOOLEAN NOT NULL DEFAULT true;

-- DropTable
DROP TABLE "agents_guichet";
