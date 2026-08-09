/**
 * One-off bulk import of university -> WhatsApp group link mappings, sourced from
 * "mehdi asim (4).xlsx" (2026-08-07). Upserts by university_name (unique key) — safe to re-run,
 * never deletes existing rows not present in this list.
 *
 * Universities with NO group link in the source sheet (skipped, not present below):
 *   University of Bristol, UWE, University of Coventry, Edge Hill University (Liverpool),
 *   University of Manchester, Manchester Metropolitan University, Newcastle University,
 *   Northumbria University, Norwich University of the Arts, University of Reading,
 *   University of York, York St John University, Buckinghamshire New University.
 * Harper Adams and Surrey had no data at all in the sheet (no university name given either).
 *
 * Run on the server after `git pull`: node scripts/seed-university-links.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../src/mysql');

const LINKS = [
  { university: 'Robert Gordon University (RGU)', groupLink: 'https://chat.whatsapp.com/GoG7FZ8jh1FGcjlzp71ZKr?mode=gi_t' },
  { university: 'Aberdeen', groupLink: 'https://chat.whatsapp.com/JN0in9902QPIpOlxqTWIFm' },
  { university: 'Aberystwyth University', groupLink: 'https://chat.whatsapp.com/CZHYKRhUb1iFHR3cv3J6uw' },
  { university: 'Bath Spa University', groupLink: 'https://chat.whatsapp.com/DsQPyqQt7z8L86hHXZOgKy' },
  { university: 'Bath University', groupLink: 'https://chat.whatsapp.com/B6kUz0JXcnGLNNHNliGEcD' },
  { university: 'Bournemouth University', groupLink: 'https://chat.whatsapp.com/C9V1QeKrhThKT7lSP9PFOP' },
  { university: 'Arts University Bournemouth', groupLink: 'https://chat.whatsapp.com/E7tXN0lLqaI1LxsddLAIBb' },
  { university: 'University of Brighton', groupLink: 'https://chat.whatsapp.com/JZmLlfS7FmtHF3sbuPwlnr?s=cl&p=i&ilr=1' },
  { university: 'University of Sussex', groupLink: 'https://chat.whatsapp.com/GYJzBCEzN1tG5wl2ZjGKAV' },
  { university: "Queen's University Belfast", groupLink: 'https://chat.whatsapp.com/ItT5P9hC5cC7nNsleJYVfu?s=cl&p=i&ilr=0' },
  { university: 'Ulster University (Belfast Campus)', groupLink: 'https://chat.whatsapp.com/JjP6tBMHmlhDaKubyezWR9?mode=gi_t' },
  { university: 'University of Warwick', groupLink: 'https://chat.whatsapp.com/IT1oSVJYUFRKxf0bXoXeIK' },
  { university: 'Chichester university', groupLink: 'https://chat.whatsapp.com/JLlkstKneIRC7XefWCG02y' },
  { university: 'University of Kent', groupLink: 'https://chat.whatsapp.com/GxlKBuuGSnSE10rS3byhX4' },
  { university: 'Canterbury Christ Church University', groupLink: 'https://chat.whatsapp.com/FNogzKq9n4ZFkp9KsUid7W' },
  { university: 'Cardiff University', groupLink: 'https://chat.whatsapp.com/CYH0PiIrggw59xg51q2zSv?mode=hqctcli' },
  { university: 'Cardiff Metropolitan University', groupLink: 'https://chat.whatsapp.com/JerNOLw9gCAGzoI7jYQkoM' },
  { university: 'USW (Cardiff campus)', groupLink: 'https://chat.whatsapp.com/JvHJE2V7mxALIifxedRslW' },
  { university: 'University of Durham', groupLink: 'https://chat.whatsapp.com/EY7vVVFb2NQKsqWhXAr5aF?mode=hqctcli' },
  { university: 'University of Dundee', groupLink: 'https://chat.whatsapp.com/IiREkTQFoQcKbqnpMIxpcv' },
  { university: 'Abertay University', groupLink: 'https://chat.whatsapp.com/JNuL3tXKQtWCGkJkNG2VKk' },
  { university: 'Heriot-Watt University', groupLink: 'https://chat.whatsapp.com/DUHyEUR8mAp40wWiMXBIl0' },
  { university: 'Edinburgh Napier University', groupLink: 'https://chat.whatsapp.com/Jc0jEhx0tqyLK14eOvpKaO' },
  { university: 'University of Edinburgh', groupLink: 'https://chat.whatsapp.com/FOCUMvAwFFvHYI5zP5f3MF' },
  { university: 'University of Exeter', groupLink: 'https://chat.whatsapp.com/JEEHFTqgoGUH1Um3VgoI86?s=cl&p=i&ilr=0' },
  { university: 'University of Glasgow', groupLink: 'https://chat.whatsapp.com/BuXtIeYmjwkKXQw4un5uPJ' },
  { university: 'Glasgow Caledonian University', groupLink: 'https://chat.whatsapp.com/GViBuPlJ67D1mKfyURmr5v' },
  { university: 'University of Strathclyde', groupLink: 'https://chat.whatsapp.com/IAsbHnAnYb54c1LvLApe7Z' },
  { university: 'University of the West of Scotland', groupLink: 'https://chat.whatsapp.com/ElSjaP0trHuAt3DAXA128O' },
  { university: 'LANCASTER', groupLink: 'https://chat.whatsapp.com/Ef32DZYug94AiuXq0meBjN' },
  { university: 'University of Leeds', groupLink: 'https://chat.whatsapp.com/LjIyoOxlLwvDRp2XOQYAnF' },
  { university: 'Leeds Beckett University', groupLink: 'https://chat.whatsapp.com/LjyUyu1lzL321KdfGlphMd' },
  { university: 'Leeds Trinity University', groupLink: 'https://chat.whatsapp.com/CS13nansbEK1XPWeN1z9MK' },
  { university: 'Leeds Arts', groupLink: 'https://chat.whatsapp.com/BCz2MEFGakL5Hud9pbt3i5' },
  { university: 'Leeds Conservatoire', groupLink: 'https://chat.whatsapp.com/DLnFO4fNz0p2bLdFfBrqOW' },
  { university: 'University of Leicester', groupLink: 'https://chat.whatsapp.com/ILnu11zHjJvGhNupypLC3V' },
  { university: 'De Montfort University', groupLink: 'https://chat.whatsapp.com/BSgsj0i36MCECvULU1NBnN' },
  { university: 'University of Lincoln', groupLink: 'https://chat.whatsapp.com/IAeJNH76JvBIyKfYlGBQXx' },
  { university: 'Bishop', groupLink: 'https://chat.whatsapp.com/Be7d4HASrNb5FzGv8lBFDg?mode=gi_t' },
  { university: 'University of Liverpool', groupLink: 'https://chat.whatsapp.com/CoLz6EgvvOp38GO86Uv18M?s=cl&p=i&ilr=0' },
  { university: 'Liverpool John Moores University', groupLink: 'https://chat.whatsapp.com/HtSNMZfQZCjFsHSECpg4bm' },
  { university: 'Liverpool Hope University', groupLink: 'https://chat.whatsapp.com/C6efPTO2mBXEXX8MRoZrao' },
  { university: 'Royal Holloway University London (RHUL)', groupLink: 'https://chat.whatsapp.com/HZr4J4voNC2951ERtNVw1i' },
  { university: 'Loughborough University', groupLink: 'https://chat.whatsapp.com/GLeE3GJz8nO2WpGEEf99Ow' },
  { university: 'University of Nottingham', groupLink: 'https://chat.whatsapp.com/KMeZBVA26dHFGARzpXBOnD' },
  { university: 'Nottingham Trent University', groupLink: 'https://chat.whatsapp.com/JlV4FjATufxJUPpKryZQ6t' },
  { university: 'University of East Anglia (UEA)', groupLink: 'https://chat.whatsapp.com/GKd9jajmyzw013YAIOdJ5Z' },
  { university: 'Oxford Brookes University', groupLink: 'https://chat.whatsapp.com/EmV0Uuf6rFgHjBn3xKS9ox' },
  { university: 'University of Plymouth', groupLink: 'https://chat.whatsapp.com/IVRimBPJtzyDhmEvCJsjhB' },
  { university: 'Plymouth Marjon University', groupLink: 'https://chat.whatsapp.com/FB548tDs1y7FGYxpLP3sbb' },
  { university: 'University of Portsmouth', groupLink: 'https://chat.whatsapp.com/ExCP4pTjChb9pdcHB6KPLL' },
  { university: 'University of Southampton', groupLink: 'https://chat.whatsapp.com/LNU2NGJwsaPCEpaSbkwgq5' },
  { university: 'Solent University', groupLink: 'https://chat.whatsapp.com/BblNK2p5r7LE6hCnMHlNsR' },
  { university: 'Swansea University', groupLink: 'https://chat.whatsapp.com/H3W6NfF8zQhCnwr9k0uaIA?s=cl&p=i&ilr=1' },
  { university: 'University of Wales Trinity Saint David (Swansea Campus)', groupLink: 'https://chat.whatsapp.com/HgsmWR22HZXHaQhypsEB9h' },
  { university: 'Staffordshire University', groupLink: 'https://chat.whatsapp.com/I4k2luM18SqCbL7Jjd3gdw' },
  { university: 'Keele', groupLink: 'https://chat.whatsapp.com/BtyT4tkOpYk1t2KJb4PBM5' },
  { university: 'University of Sheffield', groupLink: 'https://chat.whatsapp.com/EY9iZR7wNAL1lIe5txjbVZ' },
  { university: 'Sheffield Hallam University', groupLink: 'https://chat.whatsapp.com/Gz6ViAOgIAoB40lrgKmZ3k' },
  { university: 'University of Winchester', groupLink: 'https://chat.whatsapp.com/HBgV17B18QbCpuk9CwmcCc' },
];

(async () => {
  let inserted = 0;
  let updated = 0;
  for (const { university, groupLink } of LINKS) {
    // eslint-disable-next-line no-await-in-loop
    const [result] = await pool.execute(
      `INSERT INTO university_links (university_name, group_link) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE group_link = VALUES(group_link)`,
      [university, groupLink],
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
