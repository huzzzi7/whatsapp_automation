const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const { createAdminUser } = require('./create-admin');

const prisma = new PrismaClient();

async function main() {
  await createAdminUser(prisma);

  const gi = process.env.GREENAPI_INSTANCE;
  const gt = process.env.GREENAPI_TOKEN;
  if (gi && gt) {
    const existing = await prisma.greenInstance.count();
    if (existing === 0) {
      await prisma.greenInstance.create({
        data: {
          name: 'Default (from .env)',
          phoneNumber: '',
          greenInstanceId: String(gi).trim(),
          apiToken: String(gt).trim(),
        },
      });
      console.log('Seeded GreenInstance from GREENAPI_INSTANCE / GREENAPI_TOKEN');
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
