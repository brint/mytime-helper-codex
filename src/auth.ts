import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TOKEN_FILE = path.join(os.homedir(), '.mytime-helper', 'token.json');
const MYTIME_URL = 'https://mytime.slalom.com/';

interface CachedToken {
  accessToken: string;
  expiresAt: number; // unix ms
}

function loadCached(): CachedToken | null {
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
    const t: CachedToken = JSON.parse(raw);
    if (Date.now() < t.expiresAt - 60_000) return t; // 1-min buffer
  } catch {
    // file missing or unparseable — treat as no cached token
  }
  return null;
}

function saveToken(accessToken: string, expiresAt: number) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ accessToken, expiresAt }), 'utf-8');
}

function parseExpiry(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return payload.exp * 1000;
  } catch {
    return Date.now() + 80 * 60 * 1000; // fallback: 80 min
  }
}

async function fetchViaPlaywright(): Promise<string> {
  console.log('\nOpening browser for MyTime login (MFA required)...');
  console.log('Complete login in the browser window — it will close automatically.\n');

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  const tokenPromise = new Promise<string>((resolve, reject) => {
    let resolved = false;

    page.on('response', async (res) => {
      if (resolved) return;
      if (!res.url().includes('api.slalom.com')) return;

      const auth = res.request().headers()['authorization'];
      if (!auth?.startsWith('Bearer ')) return;

      const token = auth.slice(7);
      resolved = true;

      const expiresAt = parseExpiry(token);
      saveToken(token, expiresAt);

      const expiresIn = Math.round((expiresAt - Date.now()) / 60_000);
      console.log(`Token captured (expires in ~${expiresIn} min). Closing browser...`);

      await browser.close();
      resolve(token);
    });

    browser.on('disconnected', () => {
      if (!resolved) reject(new Error('Browser closed before token was captured.'));
    });
  });

  // Navigate after listeners are registered; errors surface via the 'disconnected' event above
  void page.goto(MYTIME_URL);

  return tokenPromise;
}

export async function getToken(): Promise<string> {
  const cached = loadCached();
  if (cached) return cached.accessToken;
  return fetchViaPlaywright();
}
