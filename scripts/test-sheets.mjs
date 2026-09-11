/**
 * Manual health check for the MyGym Google Sheets webhook.
 *
 * Read-only: it pings the deployment, performs the authenticated handshake, and
 * confirms a wrong key is rejected. It never writes data, so it is safe to run
 * against a sheet that already holds real backups.
 *
 * The URL and secret are read from the environment so no credential is ever
 * committed to the repository:
 *
 *   SHEETS_URL="https://script.google.com/macros/s/…/exec" \
 *   SHEETS_SECRET="your-secret" \
 *   node scripts/test-sheets.mjs
 *
 * Exits non-zero when any check fails, so it can gate a shell script or CI job.
 */
const url = process.env.SHEETS_URL?.trim();
const secret = process.env.SHEETS_SECRET?.trim();

if (!url || !secret) {
  console.error('Set SHEETS_URL and SHEETS_SECRET in the environment before running.');
  process.exit(2);
}
if (!url.startsWith('https://script.google.com/')) {
  console.error('SHEETS_URL must start with https://script.google.com/');
  process.exit(2);
}

async function post(body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  return { status: res.status, text: await res.text() };
}

let failures = 0;

function report(label, passed, detail) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures++;
}

try {
  // 1. Ping needs no key and reveals no data; it also confirms the deployment
  //    is publicly reachable rather than login-gated.
  const pingRes = await fetch(`${url}?action=ping`);
  const pingText = await pingRes.text();
  let ping;
  try {
    ping = JSON.parse(pingText);
  } catch {
    report(
      'public reachability',
      false,
      `deployment returned HTML (HTTP ${pingRes.status}); set "Who has access" to "Anyone" in Apps Script`
    );
    process.exit(1);
  }
  report('public reachability', ping.status === 'success', ping.message);

  // 2. Authenticated handshake — the same request the app sends.
  const ok = await post({ action: 'test', secretKey: secret });
  const okJson = JSON.parse(ok.text);
  report('authenticated handshake', okJson.status === 'success', okJson.message);

  // 3. A wrong key must be refused, otherwise the endpoint is not protected.
  const bad = await post({ action: 'test', secretKey: `${secret}-wrong` });
  const badJson = JSON.parse(bad.text);
  report(
    'wrong key rejected',
    badJson.status === 'error',
    badJson.message
  );
} catch (err) {
  report('connection', false, err.message);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
