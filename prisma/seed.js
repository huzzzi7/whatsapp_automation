const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const email = 'jonny@ultimatefreshersevents.com';
  const password = 'jonny@ultimatefreshersevents.com';

  const hash = await bcrypt.hash(password, 10);

  const target = await prisma.user.findUnique({ where: { email } });
  if (!target) {
    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      orderBy: { createdAt: 'asc' },
    });
    if (existingAdmin) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { email, passwordHash: hash, role: 'ADMIN' },
      });
    }
  }

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, role: 'ADMIN' },
    create: { email, passwordHash: hash, role: 'ADMIN' },
  });

  console.log('Admin ready:', email);

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
