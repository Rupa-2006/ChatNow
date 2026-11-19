-- CreateTable
CREATE TABLE "StoredFile" (
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" VARCHAR(127) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("key")
);
