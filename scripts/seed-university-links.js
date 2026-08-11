/**
 * Bulk import of university -> WhatsApp group link / Freshers' Week ticket link mappings, sourced
 * from "mehdi asim (4).xlsx". Upserts by university_name (unique key) — safe to re-run, never
 * deletes existing rows not present in this list. Updated 2026-08-10 to add ticket_link (the
 * initial 2026-08-07 import only captured group links).
 *
 * Universities with NEITHER a group nor ticket link in the source sheet (skipped entirely):
 *   University of Bristol, UWE, University of Coventry, Edge Hill University (Liverpool),
 *   University of Manchester, Manchester Metropolitan University, Newcastle University,
 *   Northumbria University, Norwich University of the Arts, University of Reading,
 *   Buckinghamshire New University.
 * Harper Adams and Surrey had no data at all in the sheet (no university name given either).
 * University of York / York St John have a ticket link but no group link — included with
 * groupLink: null.
 *
 * Run on the server after `git pull`: node scripts/seed-university-links.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../src/mysql');

const LINKS = [
  { university: 'Robert Gordon University (RGU)', groupLink: 'https://chat.whatsapp.com/GoG7FZ8jh1FGcjlzp71ZKr?mode=gi_t', ticketLink: 'https://fatso.ma/3Byf' },
  { university: 'Aberdeen', groupLink: 'https://chat.whatsapp.com/JN0in9902QPIpOlxqTWIFm', ticketLink: 'https://fatso.ma/3Byf' },
  { university: 'Aberystwyth University', groupLink: 'https://chat.whatsapp.com/CZHYKRhUb1iFHR3cv3J6uw', ticketLink: 'https://fatso.ma/3qGf' },
  { university: 'Bath Spa University', groupLink: 'https://chat.whatsapp.com/DsQPyqQt7z8L86hHXZOgKy', ticketLink: null },
  { university: 'Bath University', groupLink: 'https://chat.whatsapp.com/B6kUz0JXcnGLNNHNliGEcD', ticketLink: null },
  { university: 'Bournemouth University', groupLink: 'https://chat.whatsapp.com/C9V1QeKrhThKT7lSP9PFOP', ticketLink: 'https://fatso.ma/3sq7' },
  { university: 'Arts University Bournemouth', groupLink: 'https://chat.whatsapp.com/E7tXN0lLqaI1LxsddLAIBb', ticketLink: 'https://fatso.ma/3sq7' },
  { university: 'University of Brighton', groupLink: 'https://chat.whatsapp.com/JZmLlfS7FmtHF3sbuPwlnr?s=cl&p=i&ilr=1', ticketLink: 'https://fatso.ma/3qHs' },
  { university: 'University of Sussex', groupLink: 'https://chat.whatsapp.com/GYJzBCEzN1tG5wl2ZjGKAV', ticketLink: 'https://fatso.ma/3qHs' },
  { university: "Queen's University Belfast", groupLink: 'https://chat.whatsapp.com/ItT5P9hC5cC7nNsleJYVfu?s=cl&p=i&ilr=0', ticketLink: 'https://fatso.ma/3qFU' },
  { university: 'Ulster University (Belfast Campus)', groupLink: 'https://chat.whatsapp.com/JjP6tBMHmlhDaKubyezWR9?mode=gi_t', ticketLink: 'https://fatso.ma/3qFU' },
  { university: 'University of Warwick', groupLink: 'https://chat.whatsapp.com/IT1oSVJYUFRKxf0bXoXeIK', ticketLink: null },
  { university: 'Chichester university', groupLink: 'https://chat.whatsapp.com/JLlkstKneIRC7XefWCG02y', ticketLink: 'https://fatso.ma/3qFh' },
  { university: 'University of Kent', groupLink: 'https://chat.whatsapp.com/GxlKBuuGSnSE10rS3byhX4', ticketLink: null },
  { university: 'Canterbury Christ Church University', groupLink: 'https://chat.whatsapp.com/FNogzKq9n4ZFkp9KsUid7W', ticketLink: null },
  { university: 'Cardiff University', groupLink: 'https://chat.whatsapp.com/CYH0PiIrggw59xg51q2zSv?mode=hqctcli', ticketLink: 'https://fatso.ma/3qHm' },
  { university: 'Cardiff Metropolitan University', groupLink: 'https://chat.whatsapp.com/JerNOLw9gCAGzoI7jYQkoM', ticketLink: 'https://fatso.ma/3qGV' },
  { university: 'USW (Cardiff campus)', groupLink: 'https://chat.whatsapp.com/JvHJE2V7mxALIifxedRslW', ticketLink: 'https://fatso.ma/3qGV' },
  { university: 'University of Durham', groupLink: 'https://chat.whatsapp.com/EY7vVVFb2NQKsqWhXAr5aF?mode=hqctcli', ticketLink: 'https://fatso.ma/3qHD' },
  { university: 'University of Dundee', groupLink: 'https://chat.whatsapp.com/IiREkTQFoQcKbqnpMIxpcv', ticketLink: null },
  { university: 'Abertay University', groupLink: 'https://chat.whatsapp.com/JNuL3tXKQtWCGkJkNG2VKk', ticketLink: null },
  { university: 'Heriot-Watt University', groupLink: 'https://chat.whatsapp.com/DUHyEUR8mAp40wWiMXBIl0', ticketLink: 'https://fatso.ma/3qGd' },
  { university: 'Edinburgh Napier University', groupLink: 'https://chat.whatsapp.com/Jc0jEhx0tqyLK14eOvpKaO', ticketLink: 'https://fatso.ma/3qGd' },
  { university: 'University of Edinburgh', groupLink: 'https://chat.whatsapp.com/FOCUMvAwFFvHYI5zP5f3MF', ticketLink: 'https://fatso.ma/3qGd' },
  { university: 'University of Exeter', groupLink: 'https://chat.whatsapp.com/JEEHFTqgoGUH1Um3VgoI86?s=cl&p=i&ilr=0', ticketLink: 'https://fatso.ma/3qFy' },
  { university: 'University of Glasgow', groupLink: 'https://chat.whatsapp.com/BuXtIeYmjwkKXQw4un5uPJ', ticketLink: 'https://fatso.ma/3qFZ' },
  { university: 'Glasgow Caledonian University', groupLink: 'https://chat.whatsapp.com/GViBuPlJ67D1mKfyURmr5v', ticketLink: 'https://fatso.ma/3qFZ' },
  { university: 'University of Strathclyde', groupLink: 'https://chat.whatsapp.com/IAsbHnAnYb54c1LvLApe7Z', ticketLink: 'https://fatso.ma/3qFZ' },
  { university: 'University of the West of Scotland', groupLink: 'https://chat.whatsapp.com/ElSjaP0trHuAt3DAXA128O', ticketLink: 'https://fatso.ma/3qFZ' },
  { university: 'LANCASTER', groupLink: 'https://chat.whatsapp.com/Ef32DZYug94AiuXq0meBjN', ticketLink: 'https://fatso.ma/3qG6' },
  { university: 'University of Leeds', groupLink: 'https://chat.whatsapp.com/LjIyoOxlLwvDRp2XOQYAnF', ticketLink: 'https://fatso.ma/3qG8' },
  { university: 'Leeds Beckett University', groupLink: 'https://chat.whatsapp.com/LjyUyu1lzL321KdfGlphMd', ticketLink: 'https://fatso.ma/3qHG' },
  { university: 'Leeds Trinity University', groupLink: 'https://chat.whatsapp.com/CS13nansbEK1XPWeN1z9MK', ticketLink: 'https://fatso.ma/3qFD' },
  { university: 'Leeds Arts', groupLink: 'https://chat.whatsapp.com/BCz2MEFGakL5Hud9pbt3i5', ticketLink: 'https://fatso.ma/3qHP' },
  { university: 'Leeds Conservatoire', groupLink: 'https://chat.whatsapp.com/DLnFO4fNz0p2bLdFfBrqOW', ticketLink: null },
  { university: 'University of Leicester', groupLink: 'https://chat.whatsapp.com/ILnu11zHjJvGhNupypLC3V', ticketLink: null },
  { university: 'De Montfort University', groupLink: 'https://chat.whatsapp.com/BSgsj0i36MCECvULU1NBnN', ticketLink: null },
  { university: 'University of Lincoln', groupLink: 'https://chat.whatsapp.com/IAeJNH76JvBIyKfYlGBQXx', ticketLink: null },
  { university: 'Bishop', groupLink: 'https://chat.whatsapp.com/Be7d4HASrNb5FzGv8lBFDg?mode=gi_t', ticketLink: null },
  { university: 'University of Liverpool', groupLink: 'https://chat.whatsapp.com/CoLz6EgvvOp38GO86Uv18M?s=cl&p=i&ilr=0', ticketLink: null },
  { university: 'Liverpool John Moores University', groupLink: 'https://chat.whatsapp.com/HtSNMZfQZCjFsHSECpg4bm', ticketLink: null },
  { university: 'Liverpool Hope University', groupLink: 'https://chat.whatsapp.com/C6efPTO2mBXEXX8MRoZrao', ticketLink: null },
  { university: 'Royal Holloway University London (RHUL)', groupLink: 'https://chat.whatsapp.com/HZr4J4voNC2951ERtNVw1i', ticketLink: null },
  { university: 'Loughborough University', groupLink: 'https://chat.whatsapp.com/GLeE3GJz8nO2WpGEEf99Ow', ticketLink: 'https://fatso.ma/3qHf' },
  { university: 'University of Nottingham', groupLink: 'https://chat.whatsapp.com/KMeZBVA26dHFGARzpXBOnD', ticketLink: 'https://fatso.ma/3qGo' },
  { university: 'Nottingham Trent University', groupLink: 'https://chat.whatsapp.com/JlV4FjATufxJUPpKryZQ6t', ticketLink: 'https://fatso.ma/3qFG' },
  { university: 'University of East Anglia (UEA)', groupLink: 'https://chat.whatsapp.com/GKd9jajmyzw013YAIOdJ5Z', ticketLink: null },
  { university: 'Oxford Brookes University', groupLink: 'https://chat.whatsapp.com/EmV0Uuf6rFgHjBn3xKS9ox', ticketLink: 'https://fatso.ma/3qFt' },
  { university: 'University of Plymouth', groupLink: 'https://chat.whatsapp.com/IVRimBPJtzyDhmEvCJsjhB', ticketLink: 'https://fatso.ma/3qGs' },
  { university: 'Plymouth Marjon University', groupLink: 'https://chat.whatsapp.com/FB548tDs1y7FGYxpLP3sbb', ticketLink: 'https://fatso.ma/3qGs' },
  { university: 'University of Portsmouth', groupLink: 'https://chat.whatsapp.com/ExCP4pTjChb9pdcHB6KPLL', ticketLink: 'https://fatso.ma/3qFk' },
  { university: 'University of Southampton', groupLink: 'https://chat.whatsapp.com/LNU2NGJwsaPCEpaSbkwgq5', ticketLink: 'https://fatso.ma/3qGG' },
  { university: 'Solent University', groupLink: 'https://chat.whatsapp.com/BblNK2p5r7LE6hCnMHlNsR', ticketLink: 'https://fatso.ma/3qGG' },
  { university: 'Swansea University', groupLink: 'https://chat.whatsapp.com/H3W6NfF8zQhCnwr9k0uaIA?s=cl&p=i&ilr=1', ticketLink: 'https://fatso.ma/3qGZ' },
  { university: 'University of Wales Trinity Saint David (Swansea Campus)', groupLink: 'https://chat.whatsapp.com/HgsmWR22HZXHaQhypsEB9h', ticketLink: 'https://fatso.ma/3qGZ' },
  { university: 'Staffordshire University', groupLink: 'https://chat.whatsapp.com/I4k2luM18SqCbL7Jjd3gdw', ticketLink: null },
  { university: 'Keele', groupLink: 'https://chat.whatsapp.com/BtyT4tkOpYk1t2KJb4PBM5', ticketLink: null },
  { university: 'University of Sheffield', groupLink: 'https://chat.whatsapp.com/EY9iZR7wNAL1lIe5txjbVZ', ticketLink: 'https://fatso.ma/3qGN' },
  { university: 'Sheffield Hallam University', groupLink: 'https://chat.whatsapp.com/Gz6ViAOgIAoB40lrgKmZ3k', ticketLink: 'https://fatso.ma/3qGN' },
  { university: 'University of Winchester', groupLink: 'https://chat.whatsapp.com/HBgV17B18QbCpuk9CwmcCc', ticketLink: null },
  { university: 'University of York', groupLink: null, ticketLink: 'https://fatso.ma/3qGH' },
  { university: 'York St John University', groupLink: null, ticketLink: 'https://fatso.ma/3qGH' },
];

(async () => {
  let inserted = 0;
  let updated = 0;
  for (const { university, groupLink, ticketLink } of LINKS) {
    // eslint-disable-next-line no-await-in-loop
    const [result] = await pool.execute(
      `INSERT INTO university_links (university_name, group_link, ticket_link) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE group_link = VALUES(group_link), ticket_link = VALUES(ticket_link)`,
      [university, groupLink, ticketLink],
    );
    // MySQL affectedRows: 1 = inserted, 2 = updated (existing row changed), 0 = updated with identical value
    if (result.affectedRows === 1) inserted += 1;
    else updated += 1;
  }
  console.log(`Done. Inserted: ${inserted}, updated/unchanged: ${updated}, total: ${LINKS.length}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
