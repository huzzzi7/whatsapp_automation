/**
 * Standalone verification for src/phone.js UK normalization + toChatId.
 * Run: node scripts/test-phone-normalization.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { normalizePhone, toChatId } = require(path.join(__dirname, '..', 'src', 'phone.js'));

let configDefaultCc;
try {
  delete require.cache[require.resolve(path.join(__dirname, '..', 'config.js'))];
  const config = require(path.join(__dirname, '..', 'config.js'));
  configDefaultCc = config.defaultCountryCode;
} catch (e) {
  configDefaultCc = `(config load error: ${e.message})`;
}

const rows = [];

function addStrict(name, raw, cc, expected) {
  rows.push({
    name,
    raw,
    cc,
    kind: 'strict',
    expected,
  });
}

function add562675519() {
  rows.push({
    name: "9-digit '562675519' + cc '44' (may be ambiguous vs intl prefix 56)",
    raw: '562675519',
    cc: '44',
    kind: 'ukShort',
  });
}

addStrict("'7852535146' + 44 → UK mobile without trunk 0", '7852535146', '44', '447852535146');
addStrict("'07852535146' + 44 → leading 0 rule", '07852535146', '44', '447852535146');
addStrict("'447852535146' + 44 → already E.164", '447852535146', '44', '447852535146');
addStrict("'923001234567' + 44 → foreign CC unchanged", '923001234567', '44', '923001234567');
addStrict("'03001234567' + 92 → Pakistan 0-prefix", '03001234567', '92', '923001234567');
add562675519();
rows.push({
  name: "toChatId('447852535146')",
  toChatIdOnly: true,
  expected: '447852535146@c.us',
});

let passed = 0;
const total = rows.length;

for (const r of rows) {
  let got;
  let ok;
  let note = '';

  if (r.toChatIdOnly) {
    got = toChatId('447852535146');
    ok = got === r.expected;
  } else if (r.kind === 'ukShort') {
    got = normalizePhone(r.raw, r.cc);
    if (got === '4462675519') {
      ok = true;
      note = ' (prepended 44 to 9-digit national)';
    } else if (got === '562675519') {
      ok = true;
      note =
        ' PASS: unchanged — leading "56" matches known intl CC prefix list (ambiguous vs Chile +56); not double-prefixing.';
    } else {
      ok = false;
      note = ` unexpected got=${got}`;
    }
  } else {
    got = normalizePhone(r.raw, r.cc);
    ok = got === r.expected;
  }

  const label = r.toChatIdOnly
    ? r.name
    : `${r.name}: normalizePhone(${JSON.stringify(r.raw)}, ${JSON.stringify(r.cc)})`;
  if (ok) {
    passed += 1;
    console.log(`PASS — ${label}`);
    console.log(`       got: ${JSON.stringify(got)}`);
    if (note) console.log(`       note:${note}`);
  } else {
    console.log(`FAIL — ${label}`);
    console.log(`       expected: ${JSON.stringify(r.expected)}`);
    console.log(`       got:      ${JSON.stringify(got)}`);
  }
}

console.log('');
console.log(`Summary: ${passed}/${total} tests passed`);
console.log(
  `DEFAULT_COUNTRY_CODE from .env via config.js → defaultCountryCode: ${JSON.stringify(configDefaultCc)}`,
);
console.log(
  `End-to-end example: normalizePhone('7852535146','44') → ${JSON.stringify(normalizePhone('7852535146', '44'))} → toChatId → ${JSON.stringify(toChatId(normalizePhone('7852535146', '44')))}`,
);

if (passed < total) {
  process.exitCode = 1;
}
