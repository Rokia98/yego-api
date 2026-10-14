-- AlterTable
ALTER TABLE "reversements" ADD COLUMN     "remis_le" TIMESTAMP(3),
ADD COLUMN     "remis_par_id" INTEGER,
ADD COLUMN     "remise_note" TEXT;

