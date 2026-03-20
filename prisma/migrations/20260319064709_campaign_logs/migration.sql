-- CreateTable
CREATE TABLE "CampaignLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientCampaignId" TEXT NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "totalUniversities" INTEGER NOT NULL,
    "universityStats" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
