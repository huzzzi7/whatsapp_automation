/**
 * Create or update the dashboard admin user (Prisma + bcryptjs).
 * Run locally:  npm run create-admin
 * Run on server: node prisma/create-admin.js  (after npm install, from repo root)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const adminEmail = 'jonny@ultimatefreshersevents.com';
const adminPassword = 'jonny@ultimatefreshersevents.com';

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function createAdminUser(prisma) {
  const hash = await bcrypt.hash(adminPassword, 10);
  const name = adminEmail.split('@')[0] || 'Admin';

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: hash,
      role: 'ADMIN',
      name,
    },
    create: {
      email: adminEmail,
      passwordHash: hash,
      role: 'ADMIN',
      name,
    },
  });

  console.log('Admin ready:', adminEmail);
}

module.exports = { createAdminUser, adminEmail };

async function main() {
  const prisma = new PrismaClient();
  try {
    await createAdminUser(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
