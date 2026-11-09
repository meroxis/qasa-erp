// What the release ships and says: the build and workflow settings, the Store listing and the notices.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');

describe('the installer build (electron-builder.yml)', () => {
  const config = read('apps/desktop/electron-builder.yml');

  it('has no generateUpdatesFilesForAllChannels, which does nothing with GitHub releases (app-release-15)', () => {
    expect(config).not.toMatch(/^generateUpdatesFilesForAllChannels/m);
  });

  it('installs the third-party notices with the app (promises-15)', () => {
    expect(config).toMatch(/- from: \.\.\/\.\.\/THIRD_PARTY_NOTICES\.md\n\s+to: THIRD_PARTY_NOTICES\.md/);
  });
});

describe('the app build script (apps/desktop/build.mjs)', () => {
  const script = read('apps/desktop/build.mjs');
  const spawns = [...script.matchAll(/spawnSync\(([^;]*)\);/g)].map((m) => m[1]!);

  it('runs npm through this Node and npm-cli.js with no shell, so no argument list reaches a shell (DEP0190)', () => {
    expect(spawns.length).toBeGreaterThanOrEqual(1);
    for (const call of spawns) {
      expect(call).toMatch(/^process\.execPath, \[npmCli\(\), /);
      expect(call).toContain('shell: false');
    }
    expect(script).not.toMatch(/shell: (true|process\.platform)/);
    expect(script).not.toMatch(/['"`]npm\.cmd['"`]/);
  });
});

describe('the release workflow', () => {
  const workflow = read('.github/workflows/release.yml');
  const steps = workflow.split(/\n(?=      - )/);

  it('never leaves a token in .git/config: every checkout has persist-credentials: false', () => {
    const checkouts = steps.filter((s) => s.includes('uses: actions/checkout@'));
    expect(checkouts.length).toBeGreaterThanOrEqual(2);
    for (const step of checkouts) expect(step).toMatch(/persist-credentials: false/);
  });

  it('installs every package with no install scripts, then runs the needed ones by name', () => {
    const installs = [...workflow.matchAll(/npm ci[^\n]*/g)].map((m) => m[0]);
    expect(installs.length).toBeGreaterThanOrEqual(2);
    for (const line of installs) expect(line).toContain('--ignore-scripts');
    expect(workflow).toContain('node node_modules/esbuild/install.js');
    expect(workflow).toContain('node node_modules/electron/install.js');
    // inside its package: the script copies vendor/7z-<arch>.exe relative to the working folder
    expect(workflow).toContain('(cd node_modules/electron-winstaller && node script/select-7z-arch.js)');
  });

  it('writes the third-party notices again after the Rust module and before the installer', () => {
    const at = (text: string) => workflow.indexOf(text);
    expect(at('node scripts/third-party-notices.mjs')).toBeGreaterThan(at('node native/licence/build.mjs'));
    expect(at('node scripts/third-party-notices.mjs')).toBeLessThan(at('npm run release -w @qasa/desktop'));
  });
});

describe('the third-party notices', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');

  it('mark electron-updater and its runtime as shipped (bundled into the desktop shell) and carry the licence texts', () => {
    expect(notices).toMatch(/^\| electron-updater \| [^|]+ \| MIT \| shipped \|$/m);
    expect(notices).toMatch(/^\| builder-util-runtime \| [^|]+ \| MIT \| shipped \|$/m);
    expect(notices).toMatch(/^\| electron \| [^|]+ \| MIT \| shipped \|$/m);
    expect(notices).toContain('\n## Licence texts\n');
  });
});

describe('the Microsoft Store listing', () => {
  const listing = JSON.parse(read('apps/desktop/store-listing.json')) as {
    listings: Record<'en-us' | 'ar' | 'ku-arab', { description: string; features: string[]; shortDescription: string; releaseNotes: string }>;
  };
  const { 'en-us': en, ar, 'ku-arab': ku } = listing.listings;

  it('uses the app\'s Kurdish names for the preparer and the checker', () => {
    const all = JSON.stringify(ku);
    expect(all).not.toContain('ئامادەکەر');
    expect(all).not.toContain('پشکنەر');
    expect(all).toContain('ئامادەکار');
    expect(all).toContain('وردبین');
  });

  it('describes the trial as the app runs it: the first month free, once per PC, starting by itself', () => {
    expect(en.description).toContain('The first month on each PC is free');
    expect(en.description).toContain('once per PC');
    expect(en.description).not.toMatch(/never starts on its own|up to 5 users|You start it yourself/);
    expect(ar.description).toContain('الشهر الأول على كل حاسوب مجاني');
    expect(ar.description).toContain('مرة واحدة لكل حاسوب');
    expect(ar.description).not.toContain('مرة واحدة لكل شركة');
    expect(ku.description).toContain('مانگی یەکەم لەسەر هەر کۆمپیوتەرێک بەخۆڕاییە');
    expect(ku.description).toContain('یەک جار بۆ هەر کۆمپیوتەرێک');
    for (const text of [en.description, ar.description, ku.description]) expect(text).toContain('Qasa Relay');
  });

  it('says only the core is open source', () => {
    for (const text of [en.description, ar.description, ku.description]) expect(text).toContain('AGPL');
    expect(en.description).toContain('The core of Qasa ERP is open source');
    expect(en.description).toContain('separate proprietary module');
  });
});

describe('the release notes of 1.0.0 (kept as shipped)', () => {
  const notes = read('apps/desktop/release-notes/1.0.0.md');
  const section = (lang: 'ar' | 'en' | 'ku') => new RegExp(`^::: ${lang}\\n([\\s\\S]*?)^:::$`, 'm').exec(notes)?.[1] ?? '';

  it('tells the holders of 0.1.8 licences to connect once in the first month, before the list of what is new', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) {
      expect(section(lang).trim().length).toBeGreaterThan(500);
      expect(section(lang).indexOf('0.1.8')).toBeLessThan(section(lang).indexOf('Qasa Relay'));
    }
  });

  it('names the big 1.0 features, the language choice and the user guide', () => {
    const en = section('en');
    for (const feature of ['Payroll', 'Point of sale', 'quotations', 'sales pipeline', 'Banks & cheques', 'Fixed assets', 'Print design', 'letterhead',
      'barcode labels', 'Branches', 'several companies on one PC', 'Cloud backup', 'Qasa Relay', 'WooCommerce', 'Activation', 'language on the first screen',
      'user guide', 'Security']) expect(en, feature).toContain(feature);
    for (const word of ['الرواتب', 'نقطة البيع', 'تصميم الطباعة', 'Qasa Relay', 'دليل الاستخدام']) expect(section('ar')).toContain(word);
    for (const word of ['مووچە', 'خاڵی فرۆشتن', 'دیزاینی چاپ', 'Qasa Relay', 'ڕێنمایی بەکارهێنان']) expect(section('ku')).toContain(word);
  });

  it('names the plan of the sales pipeline (Pro) and of branches (Business), and who connects in an office', () => {
    expect(section('en')).toContain('the **sales pipeline** (Pro)');
    expect(section('en')).toContain('**Branches** (Business)');
    expect(section('ar')).toContain('**متابعة المبيعات** (Pro)');
    expect(section('ar')).toContain('**الفروع** (Business)');
    expect(section('ku')).toContain('**بەدواداچوونی فرۆشتن** (Pro)');
    expect(section('ku')).toContain('**لقەکان** (Business)');
    expect(section('en')).toMatch(/office network,\*\* the PC that keeps the company file is the one to connect/);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang)).toContain('my.qasaerp.com');
    expect(section('ku')).not.toContain('مۆڵەتی چالاکی');
  });
});

describe('the release notes of 1.0.1 (kept as shipped)', () => {
  const notes = read('apps/desktop/release-notes/1.0.1.md');
  const section = (lang: 'ar' | 'en' | 'ku') => new RegExp(`^::: ${lang}\\n([\\s\\S]*?)^:::$`, 'm').exec(notes)?.[1] ?? '';

  it('has notes in Arabic, English and Kurdish', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).trim().length).toBeGreaterThan(300);
  });

  it('says Google Drive backup works now, where to find it, and that only encrypted copies go up to files the app made itself', () => {
    expect(section('en')).toContain('Settings → Backups → Cloud backup → **Connect Google Drive**');
    expect(section('en')).toMatch(/Only \*\*encrypted\*\* copies go up/);
    expect(section('en')).toMatch(/only sees the files it makes itself/);
    expect(section('ar')).toContain('الإعدادات ← النسخ الاحتياطية ← النسخ إلى السحابة ← **ربط Google Drive**');
    expect(section('ar')).toContain('**مشفّرة**');
    expect(section('ku')).toContain('ڕێکخستنەکان ← باکئەپەکان ← باکئەپ بۆ هەور ← **پەیوەستکردنی Google Drive**');
    expect(section('ku')).toContain('**شفرەکراو**');
  });

  it('says OneDrive comes later, and never that it works now', () => {
    expect(section('en')).toContain('**OneDrive comes in a later update.**');
    expect(section('ar')).toContain('**OneDrive يأتي في تحديث لاحق.**');
    expect(section('ku')).toContain('**OneDrive لە نوێکردنەوەیەکی داهاتوودا دێت.**');
    expect(notes).not.toMatch(/Google Drive and OneDrive|Google Drive وOneDrive|Google Drive و OneDrive/);
  });

  it('still tells the holders of 0.1.8 licences to connect once in the first month, in each language', () => {
    expect(section('en')).toMatch(/0\.1\.8[\s\S]*connect this PC to the internet at least once during your first month/);
    expect(section('ar')).toMatch(/0\.1\.8[\s\S]*فاربط هذا الحاسوب بالإنترنت مرة واحدة على الأقل خلال شهرك الأول/);
    expect(notes).not.toMatch(/فصِل|فصل هذا الحاسوب/);
    expect(section('ku')).toMatch(/0\.1\.8[\s\S]*لە مانگی یەکەمت[\s\S]*یەک جار ئەم کۆمپیوتەرە بە ئینتەرنێتەوە ببەستە/);
  });
});

describe('the release notes of 1.0.2 (kept as shipped)', () => {
  const notes = read('apps/desktop/release-notes/1.0.2.md');
  const section = (lang: 'ar' | 'en' | 'ku') => new RegExp(`^::: ${lang}\\n([\\s\\S]*?)^:::$`, 'm').exec(notes)?.[1] ?? '';

  it('says Google Drive backup connects again and that the 1.0.1 sign-in error invalid_client is fixed', () => {
    expect(section('en')).toContain('**Google Drive backup connects again.**');
    expect(section('ar')).toContain('**ربط Google Drive يعمل من جديد.**');
    expect(section('ku')).toContain('**پەیوەستکردنی Google Drive دیسان کار دەکات.**');
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang)).toMatch(/1\.0\.1[\s\S]*Error 401: invalid_client/);
  });

  it('says OneDrive comes later, and never that it works now', () => {
    expect(section('en')).toContain('**OneDrive comes in a later update.**');
    expect(section('ar')).toContain('**OneDrive يأتي في تحديث لاحق.**');
    expect(section('ku')).toContain('**OneDrive لە نوێکردنەوەیەکی داهاتوودا دێت.**');
    expect(notes).not.toMatch(/Google Drive and OneDrive|Google Drive وOneDrive|Google Drive و OneDrive/);
  });
});

describe('the release notes and the Store "What\'s new" of this version', () => {
  const version = (JSON.parse(read('apps/desktop/package.json')) as { version: string }).version;
  const notes = read(`apps/desktop/release-notes/${version}.md`);
  const section = (lang: 'ar' | 'en' | 'ku') => new RegExp(`^::: ${lang}\\n([\\s\\S]*?)^:::$`, 'm').exec(notes)?.[1] ?? '';
  const listing = JSON.parse(read('apps/desktop/store-listing.json')) as {
    listings: Record<'en-us' | 'ar' | 'ku-arab', { releaseNotes: string; features: string[]; description: string }>;
  };

  const store = listing.listings;

  it('is 1.1.0, the same in the app, the core and the lock file, with notes in Arabic, English and Kurdish', () => {
    expect(version).toBe('1.1.0');
    expect(read('packages/core/src/version.ts')).toContain(`APP_VERSION = '${version}'`);
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string }> };
    expect(lock.packages['apps/desktop']?.version).toBe(version);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).trim().length).toBeGreaterThan(300);
    for (const lang of ['en-us', 'ar', 'ku-arab'] as const) expect(store[lang].releaseNotes).toContain(version);
  });

  it('keeps each Store "What\'s new" within the 1500 characters Partner Center takes, and each feature within 200', () => {
    for (const lang of ['en-us', 'ar', 'ku-arab'] as const) {
      expect(store[lang].releaseNotes.length).toBeLessThanOrEqual(1500);
      expect(store[lang].features.length).toBeLessThanOrEqual(20);
      for (const feature of store[lang].features) expect(feature.length).toBeLessThanOrEqual(200);
    }
  });

  it('names units, batches and expiry dates, the pharmacy pack, dollar balances and the POS payment methods, where they are', () => {
    expect(section('en')).toContain('Inventory → **Expiry & batches**');
    expect(section('ar')).toContain('المخزن ← **الصلاحية والوجبات**');
    expect(section('ku')).toContain('کۆگا ← **بەسەرچوون و وەجبەکان**');
    for (const label of ['**Units with conversions:**', '**Batches and expiry dates:**', '**Pharmacy (Pro):**', '**Dollar balances:**', '**Payment methods at the point of sale:**']) {
      expect(section('en')).toContain(label);
    }
    for (const lang of ['ar', 'en', 'ku'] as const) for (const word of ['FIB', '16', 'Pro']) expect(section(lang), lang).toContain(word);
    for (const words of ['Units with conversions', 'Batches and expiry dates', 'Pharmacy pack (Pro)']) expect(store['en-us'].releaseNotes).toContain(words);
    expect(store['en-us'].features.some((f) => /Units with conversions/.test(f))).toBe(true);
    expect(store.ar.features.some((f) => /الوحدات وتحويلها/.test(f))).toBe(true);
    expect(store['ku-arab'].features.some((f) => /یەکەکان و گۆڕینیان/.test(f))).toBe(true);
  });

  it('says plainly that 1.0 cannot open a company file 1.1 has upgraded, so every PC and the Store version are updated', () => {
    expect(section('en')).toContain('Qasa ERP 1.0 cannot open a file that 1.1 has upgraded');
    expect(section('ar')).toContain('لا يفتح قاصة ERP 1.0 ملفاً رقّاه الإصدار 1.1');
    expect(section('ku')).toContain('قاسە ERP 1.0 فایلێک ناکاتەوە کە 1.1 بەرزی کردبێتەوە');
    expect(store['en-us'].releaseNotes).toContain('update every PC that opens it');
  });

  it('never says the automatic daily backups came to Free: they stay with Pro and Business', () => {
    const all = [notes, ...Object.values(store).flatMap((l) => [l.releaseNotes, ...l.features])].join('\n');
    expect(all).not.toMatch(/automatic (daily )?backups? on every plan|daily backups? on (every plan|Free)/i);
    expect(all).not.toMatch(/النسخ (الاحتياطي )?(اليومي|التلقائي) في كل الخطط|باکئەپی (ڕۆژانە|خۆکار)[^.]*هەموو پلانەکان/);
  });

  it('writes Kurdish with no tatweel', () => {
    expect(section('ku')).not.toContain('ـ');
    expect(store['ku-arab'].releaseNotes).not.toContain('ـ');
  });

  it('still tells the holders of 0.1.8 licences to connect once in the first month, in each language and in the Store text', () => {
    expect(section('en')).toMatch(/0\.1\.8[\s\S]*connect this PC to the internet at least once during your first month/);
    expect(section('ar')).toMatch(/0\.1\.8[\s\S]*فاربط هذا الحاسوب بالإنترنت مرة واحدة على الأقل خلال شهرك الأول/);
    // «فصِل» read without its kasra means 'disconnect': never use it for this step
    expect(notes + listing.listings.ar.releaseNotes).not.toMatch(/فصِل|فصل هذا الحاسوب/);
    expect(section('ku')).toMatch(/0\.1\.8[\s\S]*لە مانگی یەکەمت[\s\S]*یەک جار ئەم کۆمپیوتەرە بە ئینتەرنێتەوە ببەستە/);
    expect(store['en-us'].releaseNotes).toMatch(/0\.1\.8: connect this PC to the internet once during your first month/);
    expect(store.ar.releaseNotes).toMatch(/0\.1\.8: اربط هذا الحاسوب بالإنترنت مرة واحدة خلال شهرك الأول/);
    // 'it keeps working meanwhile', never 'it works until then'
    expect(store.ar.releaseNotes).toContain('ويبقى يعمل في هذه الأثناء');
    expect(store['ku-arab'].releaseNotes).toContain('لەو ماوەیەدا هەر کار دەکات');
    expect(store.ar.releaseNotes + store['ku-arab'].releaseNotes).not.toMatch(/يبقى يعمل حتى ذلك|تا ئەو کاتە کار دەکات/);
    expect(store['ku-arab'].releaseNotes).toMatch(/0\.1\.8: لە مانگی یەکەمت[^؛]*یەک جار ئەم کۆمپیوتەرە بە ئینتەرنێتەوە ببەستە/);
  });

  it('the Store text says a paid licence is activated online, next to "works without internet"', () => {
    const l = listing.listings as unknown as Record<string, { description: string; features: string[] }>;
    expect(l['en-us']!.description).toMatch(/works without internet; a Pro or Business licence is activated online once/);
    expect(l.ar!.description).toMatch(/يعمل دون إنترنت؛ أما ترخيص Pro أو Business فيُفعَّل عبر الإنترنت/);
    expect(l['ku-arab']!.description).toMatch(/بەبێ ئینتەرنێت کار دەکات؛ مۆڵەتی Pro یان Business یەک جار بە ئینتەرنێت چالاک دەکرێت/);
    for (const lang of ['en-us', 'ar', 'ku-arab']) {
      const offline = l[lang]!.features.at(-1)!;
      expect(offline.length).toBeLessThanOrEqual(200);
      expect(offline).toMatch(/activated online|يُفعَّل عبر الإنترنت|بە ئینتەرنێت چالاک/);
    }
  });

  it('never offers the phone app or the online edition (not in 1.0)', () => {
    const all = [notes, ...Object.values(listing.listings).map((l) => l.releaseNotes)].join('\n');
    expect(all).not.toMatch(/phone app|mobile app|online edition|Google Play|App Store|iPhone|Android/i);
    expect(all).not.toMatch(/تطبيق (الموبايل|الهاتف)|النسخة (السحابية|على الإنترنت)|ئەپی مۆبایل|وەشانی ئۆنلاین/);
  });
});

describe('the licence addon (native/licence) is proprietary, not open source', () => {
  it('says so in its Cargo.toml and its own LICENSE', () => {
    const cargo = read('native/licence/Cargo.toml');
    expect(cargo).toMatch(/^license = "LicenseRef-Proprietary"$/m);
    expect(cargo).toMatch(/^publish = false$/m);
    expect(cargo).not.toMatch(/AGPL|MIT|Apache/);
    const licence = read('native/licence/LICENSE');
    expect(licence).toMatch(/Copyright \(c\) \d{4} Meroxis\. All rights reserved\./);
    expect(licence).toContain('not open source');
  });

  it('is never called open source in the notices, the NOTICE, the README or the EULA', () => {
    const notices = read('THIRD_PARTY_NOTICES.md');
    expect(notices).toMatch(/licence module \(native\/licence\)[^.]*not open source/);
    expect(notices).not.toMatch(/^\| qasa-licence \|/m);
    expect(read('NOTICE')).toMatch(/Not covered by this license: the licence module in native\/licence/);
    const readme = read('README.md');
    expect(readme).toMatch(/licence addon \(`native\/licence`\) is\s+proprietary/);
    expect(readme).toMatch(/core app \(everything in this repository except `native\/licence`\) is free software/);
    const legal = read('apps/web/src/i18n/legal.ts');
    expect(legal).toContain('and the licence module are proprietary to Meroxis, not open source');
  });
});

describe('the README', () => {
  const readme = read('README.md');

  it('says the core is AGPL and the Pro and Business features are a separate proprietary module (promises-10)', () => {
    expect(readme).not.toContain('every line of the app is here');
    expect(readme).toMatch(/the core app[^.]*under the AGPL/);
    expect(readme).toContain('separate proprietary module');
  });
});

describe('the release checklist (docs/releasing.md) and the handoff notes (docs/HANDOFF.md)', () => {
  const releasing = read('docs/releasing.md');
  const handoff = read('docs/HANDOFF.md');

  it('says a stable GitHub release writes latest.yml only, which beta copies read too (app-release-15)', () => {
    expect(releasing).toMatch(/^\| Update file \| `latest\.yml` only \(beta copies read it too\) \| `beta\.yml` \|$/m);
    expect(releasing).not.toMatch(/stable release also writes `beta\.yml`|`latest\.yml` and `beta\.yml`/);
  });

  it('carries the 1.0 release-day steps: relay DNS and firewall, Cloudflare bots, licences, notes, no phone app', () => {
    for (const doc of [releasing, handoff]) {
      // no DNS-only name and no public port 8790: websites send sealed requests through Cloudflare too
      expect(doc).not.toMatch(/relay-direct|8790 (open|for the plugin)|RELAY_HOST=0\.0\.0\.0/);
      expect(doc).toMatch(/`relay\.qasaerp\.com`[^\n]*(orange|proxied)/);
      expect(doc).toContain('RELAY_HOST=127.0.0.1');
      expect(doc).toMatch(/RELAY_REQUIRE_ACTIVATION=1[^\n]*only (after|once)/);
      expect(doc).toMatch(/80 and 443[^\n]*from Cloudflare('s IP ranges)? only/);
      expect(doc).toContain('Bot Fight Mode');
      expect(doc).toContain('licensing/issue.mjs');
      expect(doc).toMatch(/connect[^\n]*once in the first month/);
      expect(doc).toContain('The phone app is not in 1.0');
      expect(doc).toContain('no release-date constant');
    }
    // the old plan (the relay name DNS only) is gone
    expect(handoff).not.toMatch(/DNS relay\.qasaerp\.com DNS-only/);
    expect(handoff).not.toMatch(/phone app link,/);
    expect(read('docs/store-compliance.md')).toMatch(/## Google Play[^\n]*\n\nThe phone app is not in 1\.0/);
  });

  it('names the author every commit carries', () => {
    expect(handoff).toContain('meroxis <333022010+meroxis@users.noreply.github.com>');
    expect(handoff).not.toContain('host4kurd@gmail.com');
  });

  it('opens with where the work stands, naming no tool to continue it with', () => {
    expect(handoff.split('\n')[2]).toBe('This branch and its sister branches carry the 1.0 work. Pick up from here.');
  });
});
