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

  it('says how a beta becomes a prerelease the way the workflow really does it: gh in the publish job, not a -c flag', () => {
    expect(config).not.toContain('-c.publish.releaseType');
    expect(read('.github/workflows/release.yml')).not.toContain('releaseType');
    expect(config).toContain('gh release create --prerelease');
    expect(read('.github/workflows/release.yml')).toMatch(/extra=\(--prerelease\)/);
    expect(read('apps/desktop/package.json')).toContain('electron-builder --win --publish never');
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
    expect(at('node scripts/third-party-notices.mjs')).toBeLessThan(at('npm run dist -w @qasa/desktop'));
  });

  it('builds with no token that writes releases; a second job that runs no project code checks the files and publishes them', () => {
    const jobs = workflow.split('\n  publish:\n');
    expect(jobs).toHaveLength(2);
    const [build, publish] = jobs as [string, string];
    expect(build).toMatch(/^permissions:\n  contents: read/m);
    expect(build).not.toContain('contents: write');
    expect(build).not.toContain('GITHUB_TOKEN');
    expect(build).not.toContain('--publish always');
    expect(build).toContain('npm run dist -w @qasa/desktop');
    expect(build).toContain('sha256sum * > SHA256SUMS');
    expect(publish).toContain('contents: write');
    expect(publish).toContain('environment: release');
    expect(publish).toContain('sha256sum --check --strict SHA256SUMS');
    // nothing of the repository runs where the token is: no checkout, no npm, no node
    expect(publish).not.toMatch(/actions\/checkout|npm |node /);
    expect(read('native/licence/build.mjs')).toContain("'--locked'");
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
    expect(en.description).toContain('The Starter, Pro and Business features are a separate proprietary module.');
    expect(read('apps/desktop/store-listing.json')).toContain('the Starter, Pro and Business features are a separate proprietary module under the Qasa ERP license terms');
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

  it('is 1.3.0, the same in the app, the core and the lock file, with notes in Arabic, English and Kurdish', () => {
    expect(version).toBe('1.3.0');
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

  it('tells of the bigger menu, Settings as rectangles and the Employees group, in the words the app uses', () => {
    const words = read('apps/web/src/i18n.ts');
    expect(words).toContain("gPeople: ['الموظفون', 'Employees', 'کارمەندان']");
    expect(words).toContain("displayTitle: ['اللغة والعرض', 'Language and display', 'زمان و پیشاندان']");
    expect(words).toContain("densityCompact: ['مضغوط', 'Compact', 'چڕ']");
    expect(section('en')).toContain('the menu at the side has bigger text and taller rows, and each group heading is a row of its own with an icon');
    expect(section('en')).toContain('The **Compact** density (Settings → **Language and display**) keeps the menu near its old size.');
    expect(section('ar')).toContain('كثافة العرض **مضغوط** (الإعدادات ← **اللغة والعرض**) تُبقي القائمة قريبة من حجمها السابق.');
    expect(section('ku')).toContain('چڕیی پیشاندانی **چڕ** (ڕێکخستنەکان ← **زمان و پیشاندان**) لیستەکە نزیک لە قەبارەی پێشووی دەهێڵێتەوە.');
    expect(section('en')).toContain('Settings opens as a grid of rectangles, one for each section. Each section opens on its own page, with a **Back** link at the top.');
    expect(section('ar')).toContain('تفتح الإعدادات كشبكة من المستطيلات، مستطيل لكل قسم.');
    expect(section('ku')).toContain('ڕێکخستنەکان وەک تۆڕێک لە لاکێشە دەکرێنەوە، بۆ هەر بەشێک لاکێشەیەک.');
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang), lang).toMatch(/[*]{2}People[*]{2}.*[*]{2}Employees[*]{2}/);
    expect(store['en-us'].releaseNotes).toContain('The side menu has bigger text and rows, and Settings opens as rectangles to click.');
    expect(store.ar.releaseNotes).toContain('القائمة الجانبية صار نصها أكبر وصفوفها أعلى، والإعدادات تفتح كمستطيلات تنقر عليها.');
    expect(store['ku-arab'].releaseNotes).toContain('لیستی لا گەورەتر بووە، و ڕێکخستنەکان وەک لاکێشە دەکرێنەوە.');
  });

  it('tells of adding a customer or supplier in the box and of the one save button (F9), with the names the buttons carry', () => {
    const words = read('apps/web/src/i18n/invoice-speed.ts');
    expect(words).toContain("sv_print_next: ['حفظ وطباعة والتالية', 'Save, print and next', 'پاشەکەوت، چاپ و داهاتوو']");
    expect(words).toContain("sv_whatsapp: ['حفظ وإرسال على واتساب', 'Save and send on WhatsApp', 'پاشەکەوت و ناردن بە واتسئاپ']");
    expect(read('apps/web/src/pages/Invoices.tsx')).toContain('shortcut="F9"');
    expect(section('en')).toContain('a **+** inside the customer or supplier box adds a new one on the spot: name, phone, city or address, and the price list for a customer.');
    expect(section('en')).toContain('one **Save, print and next** button (**F9**). Its menu holds the other ways: **Save and print**, **Save and next**, **Save and send on WhatsApp**, **Post invoice** and **Save as draft**. The button remembers the way you chose last.');
    expect(section('ar')).toContain('زر واحد **حفظ وطباعة والتالية** (**F9**). وفي قائمته الطرق الأخرى: **حفظ وطباعة**، **حفظ والتالية**، **حفظ وإرسال على واتساب**، **ترحيل الفاتورة** و**حفظ كمسودة**.');
    expect(section('ku')).toContain('یەک دوگمەی **پاشەکەوت، چاپ و داهاتوو**یان هەیە (**F9**). لە لیستەکەیدا ڕێگەکانی تر هەن: **پاشەکەوت و چاپ**، **پاشەکەوت و داهاتوو**، **پاشەکەوت و ناردن بە واتسئاپ**، **تۆمارکردنی پسوولە** و **پاشەکەوت وەک ڕەشنووس**.');
    expect(section('ar')).toContain('وتنبهك قاصة إذا وُجد من له الهاتف نفسه أو الاسم نفسه.');
    expect(section('ku')).toContain('قاسە ئاگادارت دەکاتەوە ئەگەر کەسێک بە هەمان تەلەفۆن یان هەمان ناو پێشتر هەبێت.');
    expect(store['en-us'].releaseNotes).toContain('On invoices, a + in the customer or supplier box adds a new one, and one button (F9) saves, prints and opens the next.');
    expect(store.ar.releaseNotes).toContain('علامة + داخل خانة الزبون أو المجهز تضيف واحداً جديداً في مكانه، وزر واحد (F9) يحفظ ويطبع ويفتح الفاتورة التالية.');
    expect(store['ku-arab'].releaseNotes).toContain('«+» لە خانەی کڕیار یان دابینکەر یەکێکی نوێ زیاد دەکات، و دوگمەی F9 پاشەکەوت و چاپ دەکات و پسوولەی داهاتوو دەکاتەوە.');
  });

  it('names the Starter plan as the app has it: 165,000 IQD a year, 2 users, 1 company, every Pro feature except Qasa Relay and the cloud backup', () => {
    // the app's own plan table (packages/core/src/plans.ts): the texts say what it says
    const plans = read('packages/core/src/plans.ts');
    expect(plans).toContain('PLAN_PRICE_IQD: Readonly<Record<PaidPlanId, number>> = { starter: 165_000, pro: 350_000, business: 1_000_000 }');
    expect(plans).toContain("starter: { id: 'starter', limits: { companies: 1, users: 2, warehouses: null }, features: STARTER_FEATURES }");
    expect(plans).toContain("STARTER_LEAVES_OUT: readonly Feature[] = ['relay', 'cloudBackup']");
    expect(section('en')).toContain('**Starter plan:** a new plan between Free and Pro, at 165,000 IQD a year: **2 users** and **1 company**, warehouses without a limit, and every Pro feature except **Qasa Relay** and the **cloud backup**.');
    expect(section('ar')).toContain('**خطة Starter:** خطة جديدة بين المجانية وPro، بسعر 165,000 دينار عراقي في السنة: **مستخدمان** و**شركة واحدة**، ومخازن بلا حد، وكل ميزات Pro عدا **Qasa Relay** و**النسخ إلى السحابة**.');
    expect(section('ku')).toContain('**پلانی Starter:** پلانێکی نوێ لە نێوان بەخۆڕایی و Pro، بە 165,000 دیناری عێراقی بۆ ساڵێک: **2 بەکارهێنەر** و **یەک کۆمپانیا**، کۆگای بێ سنوور، و هەموو تایبەتمەندییەکانی Pro جگە لە **Qasa Relay** و **باکئەپ بۆ هەور**.');
    // the office network on Starter: the office's own network, not the internet
    expect(section('en')).toContain("The office network works inside the office, on the office's own network, and not over the internet");
    expect(section('ar')).toContain('تعمل شبكة المكتب داخل المكتب على شبكته نفسها، لا عبر الإنترنت');
    expect(section('ku')).toContain('تۆڕی نووسینگە لەناو نووسینگە لەسەر تۆڕی خودی نووسینگە کار دەکات، نەک لە ڕێی ئینتەرنێتەوە');
    for (const lang of ['en-us', 'ar', 'ku-arab'] as const) {
      for (const words of ['Starter', '165,000', 'Qasa Relay', 'Pro', 'Business']) expect(store[lang].releaseNotes, lang).toContain(words);
    }
    expect(store['en-us'].releaseNotes).toContain('New Starter plan, between Free and Pro: 165,000 IQD a year, 2 users and 1 company, warehouses without a limit, and every Pro feature except Qasa Relay and the cloud backup.');
    expect(store.ar.releaseNotes).toContain('165,000 دينار عراقي في السنة، مستخدمان وشركة واحدة، ومخازن بلا حد، وكل ميزات Pro عدا Qasa Relay والنسخ إلى السحابة.');
    expect(store['ku-arab'].releaseNotes).toContain('165,000 دیناری عێراقی بۆ ساڵێک، 2 بەکارهێنەر و یەک کۆمپانیا، کۆگای بێ سنوور، و هەموو تایبەتمەندییەکانی Pro جگە لە Qasa Relay و باکئەپ بۆ هەور.');
  });

  it('says a Starter licence needs 1.3.0 or later, and to update every PC before entering the key', () => {
    expect(section('en')).toContain("**A Starter licence needs Qasa ERP 1.3.0 or later.** Earlier versions don't accept its key: update every PC first, then enter the key in **Plan & license**.");
    expect(section('ar')).toContain('**ترخيص Starter يحتاج قاصة ERP 1.3.0 أو أحدث.** الإصدارات الأقدم لا تقبل مفتاحه: حدّث كل الحواسيب أولاً، ثم أدخل المفتاح في **الخطة والترخيص**.');
    expect(section('ku')).toContain('**مۆڵەتی Starter پێویستی بە قاسە ERP 1.3.0 یان نوێتر هەیە.** وەشانە کۆنترەکان کلیلەکەی وەرناگرن: سەرەتا هەموو کۆمپیوتەرەکان نوێ بکەرەوە، پاشان کلیلەکە لە **پلان و مۆڵەت** داخڵ بکە.');
    expect(store['en-us'].releaseNotes).toContain('A Starter licence needs Qasa ERP 1.3.0 or later');
    expect(store.ar.releaseNotes).toContain('ترخيص Starter يحتاج قاصة ERP 1.3.0 أو أحدث');
    expect(store['ku-arab'].releaseNotes).toContain('مۆڵەتی Starter پێویستی بە قاسە ERP 1.3.0 یان نوێتر هەیە');
    // why: a licence key and an activation token may name only the plans the app knows (1.2.1 knew pro and business)
    expect(read('packages/server/src/license.ts')).toContain('plan: z.enum(PAID_PLAN_IDS)');
    expect(read('packages/server/src/activation.ts')).toContain('plan: z.enum(PAID_PLAN_IDS)');
    expect(read('packages/core/src/plans.ts')).toContain("PAID_PLAN_IDS = ['starter', 'pro', 'business'] as const");
  });

  it('says the number of users in a plan now counts at sign-in on every plan: admins first, then the earliest made, and nothing is deleted', () => {
    expect(section('en')).toContain('**The number of users in your plan now counts at sign-in too, on every plan** (Free 1, Starter 2, Pro 5, Business without a limit, or the number written in your licence).');
    expect(section('ar')).toContain('**عدد المستخدمين في خطتك صار يُحسب عند تسجيل الدخول أيضاً، في كل الخطط** (المجانية 1، Starter 2، Pro 5، Business بلا حد، أو العدد المكتوب في ترخيصك).');
    expect(section('ku')).toContain('**ژمارەی بەکارهێنەرانی پلانەکەت ئێستا لە کاتی چوونەژوورەوەشدا دەژمێردرێت، لە هەموو پلانەکاندا** (بەخۆڕایی 1، Starter 2، Pro 5، Business بێ سنوور، یان ئەو ژمارەیەی لە مۆڵەتەکەتدا نووسراوە).');
    expect(section('en')).toContain('only as many as the plan allows can sign in: admins first, then the users made earliest');
    expect(section('ar')).toContain('فلا يستطيع الدخول إلا العدد الذي تسمح به الخطة: المدراء أولاً، ثم الأقدم إنشاءً');
    expect(section('ku')).toContain('تەنها ئەو ژمارەیەی پلانەکە ڕێگەی پێدەدات دەتوانن بچنە ژوورەوە: سەرەتا بەڕێوەبەران، پاشان ئەوانەی زووتر دروستکراون');
    // the Users page's own words for the mark, and where the page is
    expect(section('en')).toContain('Settings → **Users** marks them **Over the plan**');
    expect(section('ar')).toContain('الإعدادات ← **المستخدمون** علامة **فوق حد الخطة**');
    expect(section('ku')).toContain('ڕێکخستنەکان ← **بەکارهێنەران** نیشانەی **سەروو سنووری پلان**');
    expect(read('apps/web/src/i18n.ts')).toContain("userOverLimit: ['فوق حد الخطة', 'Over the plan', 'سەروو سنووری پلان']");
    expect(section('en')).toContain('**Nothing is deleted and no user is switched off**, and an admin always keeps a place');
    expect(section('ar')).toContain('**لا يُحذف شيء ولا يُوقَف أي مستخدم**، ويبقى للمدير مكان دائماً');
    expect(section('ku')).toContain('**هیچ شتێک ناسڕدرێتەوە و هیچ بەکارهێنەرێک ناچالاک ناکرێت**، و بەڕێوەبەر هەمیشە شوێنی دەمێنێت');
    expect(store['en-us'].releaseNotes).toContain('The number of users in your plan now counts at sign-in too, on every plan (Free 1, Starter 2, Pro 5, Business without a limit');
    expect(store['en-us'].releaseNotes).toContain('admins first, then the users made earliest');
    expect(store['en-us'].releaseNotes).toContain('Nothing is deleted and no user is switched off');
    expect(store.ar.releaseNotes).toContain('عدد المستخدمين في خطتك صار يُحسب عند تسجيل الدخول أيضاً، في كل الخطط');
    expect(store.ar.releaseNotes).toContain('المدراء أولاً، ثم الأقدم إنشاءً');
    expect(store.ar.releaseNotes).toContain('لا يُحذف شيء ولا يُوقَف أي مستخدم');
    expect(store['ku-arab'].releaseNotes).toContain('ژمارەی بەکارهێنەرانی پلانەکەت ئێستا لە کاتی چوونەژوورەوەشدا دەژمێردرێت، لە هەموو پلانەکاندا');
    expect(store['ku-arab'].releaseNotes).toContain('سەرەتا بەڕێوەبەران، پاشان ئەوانەی زووتر دروستکراون');
    expect(store['ku-arab'].releaseNotes).toContain('هیچ شتێک ناسڕدرێتەوە و هیچ بەکارهێنەرێک ناچالاک ناکرێت');
  });

  it('lists four plans in the Store description, each paid one with its price for a year, and one feature line for them', () => {
    const d = { en: store['en-us'].description, ar: store.ar.description, ku: store['ku-arab'].description };
    expect(d.en).toContain('• Starter (165,000 IQD a year): 2 users and 1 company, warehouses without a limit, and every Pro feature except Qasa Relay and the cloud backup.');
    expect(d.en).toContain('• Pro (350,000 IQD a year): 5 users and 3 companies, with Qasa Relay');
    expect(d.en).toContain('• Business (1,000,000 IQD a year): users and companies without a limit');
    expect(d.ar).toContain('• Starter (165,000 دينار عراقي في السنة): مستخدمان وشركة واحدة، ومخازن بلا حد، وكل ميزات Pro عدا Qasa Relay والنسخ إلى السحابة.');
    expect(d.ar).toContain('• Pro (350,000 دينار عراقي في السنة): حتى 5 مستخدمين و3 شركات، مع Qasa Relay');
    expect(d.ar).toContain('• Business (1,000,000 دينار عراقي في السنة): مستخدمون وشركات بلا حد');
    expect(d.ku).toContain('• Starter (165,000 دیناری عێراقی بۆ ساڵێک): 2 بەکارهێنەر و یەک کۆمپانیا، کۆگای بێ سنوور، و هەموو تایبەتمەندییەکانی Pro جگە لە Qasa Relay و باکئەپ بۆ هەور.');
    expect(d.ku).toContain('• Pro (350,000 دیناری عێراقی بۆ ساڵێک): تا 5 بەکارهێنەر و 3 کۆمپانیا، لەگەڵ Qasa Relay');
    expect(d.ku).toContain('• Business (1,000,000 دیناری عێراقی بۆ ساڵێک): بەکارهێنەر و کۆمپانیای بێ سنوور');
    // the plans in their order (Free, Starter, Pro, Business) before the free first month
    for (const text of Object.values(d)) {
      const at = ['\n• Starter (165,000', '\n• Pro (350,000', '\n• Business (1,000,000'].map((w) => text.indexOf(w));
      expect(at[0]).toBeGreaterThan(0);
      expect(at[1]).toBeGreaterThan(at[0]!);
      expect(at[2]).toBeGreaterThan(at[1]!);
      // Partner Center takes 10,000 characters for a description
      expect(text.length).toBeLessThanOrEqual(10_000);
    }
    expect(d.en).toContain('only that many can sign in (admins first, then the earliest made); no user is deleted');
    expect(d.en).toContain('buy a Starter, Pro or Business license at my.qasaerp.com (sold outside the Store)');
    expect(d.ar).toContain('تشتري ترخيص Starter أو Pro أو Business من my.qasaerp.com (يُباع خارج المتجر)');
    expect(d.ku).toContain('مۆڵەتی Starter، Pro یان Business لە my.qasaerp.com دەکڕیت (لە دەرەوەی Store دەفرۆشرێت)');
    expect(store['en-us'].features).toContain('Four plans: Free, Starter (2 users, 1 company, every Pro feature except Qasa Relay and the cloud backup), Pro and Business; licences are sold at my.qasaerp.com');
    expect(store.ar.features.some((f) => f.startsWith('أربع خطط: المجانية، وStarter (مستخدمان وشركة واحدة وكل ميزات Pro عدا Qasa Relay والنسخ إلى السحابة)، وPro وBusiness'))).toBe(true);
    expect(store['ku-arab'].features.some((f) => f.startsWith('چوار پلان: بەخۆڕایی، Starter (2 بەکارهێنەر، یەک کۆمپانیا و هەموو تایبەتمەندییەکانی Pro جگە لە Qasa Relay و باکئەپ بۆ هەور)، Pro و Business'))).toBe(true);
  });

  it('marks as (Pro) only what Starter leaves out (Qasa Relay, the cloud backup); what Starter has too is for the paid plans', () => {
    // why: Starter has these too, so "(Pro)" beside them would tell a Starter buyer they are missing
    const starter = /STARTER_FEATURES: readonly Feature\[\] = \[([^\]]*)\]/.exec(read('packages/core/src/plans.ts'))?.[1] ?? '';
    for (const feature of ['officeNetwork', 'installments', 'finalAccountsExport', 'autoBackup', 'pharmacy', 'loyalty', 'noBranding']) expect(starter, feature).toContain(`'${feature}'`);
    for (const lang of ['en-us', 'ar', 'ku-arab'] as const) {
      const lines = [...store[lang].description.split('\n'), ...store[lang].features];
      const pro = lines.filter((line) => line.includes('(Pro)'));
      expect(pro.length, lang).toBe(4);
      for (const line of pro) expect(line, lang).toMatch(/Qasa Relay|Google Drive/);
      for (const feature of store[lang].features) expect(feature.length, lang).toBeLessThanOrEqual(200);
      expect(store[lang].description.length, lang).toBeLessThanOrEqual(10000);
    }
    expect(store['en-us'].description).toContain("a printed contract with the guarantor's pledge (paid plans).");
    expect(store['en-us'].description).toContain('• Pharmacy (paid plans):');
    expect(store['en-us'].description).toContain('the office network for several PCs, daily encrypted backups and year-end closing (paid plans);');
    expect(store['en-us'].features.some((f) => f.endsWith('and loyalty points (paid plans)'))).toBe(true);
    expect(store.ar.description).toContain('وإقفال السنة (الخطط المدفوعة)،');
    expect(store.ar.description).toContain('• الصيدلية (الخطط المدفوعة):');
    expect(store['ku-arab'].description).toContain('داخستنی ساڵ (پلانە پارەدارەکان)،');
    expect(store['ku-arab'].description).toContain('• دەرمانخانە (پلانە پارەدارەکان):');
    expect(read('apps/desktop/store-listing.json')).toContain('the optional office network (paid plans) listens on the local network');
  });

  it('names Starter with Pro and Business where the README and NOTICE say who may remove the credit on invoices', () => {
    // why: Starter has noBranding too, so the licence texts name all three paid plans
    const readme = read('README.md');
    const notice = read('NOTICE');
    expect(readme).toContain('unless you have a Starter, Pro or Business license from');
    expect(readme).toContain('the Starter, Pro and Business features are a');
    expect(notice).toContain('only under a valid Qasa ERP Starter,\n   Pro or Business license obtained from https://qasaerp.com.');
    expect(notice).toContain('A commercial Starter, Pro or Business license that removes the');
    expect(readme + notice).not.toMatch(/(?<!Starter,\s+)Pro (or|and) Business (license|features)/);
  });

  it('never says Starter comes with Qasa Relay or the cloud backup', () => {
    const all = [notes, ...Object.values(store).flatMap((l) => [l.releaseNotes, l.description, ...l.features])].join('\n');
    expect(all).not.toMatch(/Starter[^.\n]*\b(with|includes|including) (Qasa Relay|the cloud backup)/i);
    expect(all).not.toMatch(/Starter[^.\n]*(مع|يشمل|تشمل) (Qasa Relay|النسخ إلى السحابة)/);
    expect(all).not.toMatch(/Starter[^.\n]*لەگەڵ (Qasa Relay|باکئەپ بۆ هەور)/);
  });

  it('keeps the README plan table in step: a Starter column between Free and Pro', () => {
    const readme = read('README.md');
    expect(readme).toContain('| | Free | Starter | Pro | Business |');
    expect(readme).toContain('| A year, in Iraqi dinars | free | 165,000 | 350,000 | 1,000,000 |');
    expect(readme).toContain('| Users, with sign-in | 1 | 2, with roles and separate duties | up to 5, with roles and separate duties | unlimited |');
    expect(readme).toContain('| Qasa Relay (the office network from anywhere over the internet) | | | ✓ | ✓ |');
    expect(readme).toContain('| Encrypted cloud backup to Google Drive | | | ✓ | ✓ |');
    expect(readme).toContain('| Companies | 1 | 1 | 3 | unlimited |');
    // every row of the table has the five columns
    const rows = readme.slice(readme.indexOf('| | Free | Starter | Pro | Business |'), readme.indexOf('\n\nSome features are still being built')).split('\n');
    expect(rows.length).toBeGreaterThan(15);
    for (const row of rows) expect(row.split('|').length, row).toBe(7);
  });

  it('upgrades no company file in 1.3.0, so it has no "Before you update" warning', () => {
    expect(notes).not.toMatch(/Before you update|قبل التحديث|پێش نوێکردنەوە/);
    const all = [notes, ...Object.values(store).map((l) => l.releaseNotes)].join('\n');
    expect(all).not.toMatch(/company file is upgraded|يُرقّى ملف الشركة|فایلی کۆمپانیا بەرز دەکرێتەوە/);
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

  it('the Store text says a paid licence (Starter, Pro or Business) is activated online, next to "works without internet"', () => {
    const l = listing.listings as unknown as Record<string, { description: string; features: string[] }>;
    expect(l['en-us']!.description).toMatch(/works without internet; a Starter, Pro or Business licence is activated online once/);
    expect(l.ar!.description).toMatch(/يعمل دون إنترنت؛ أما ترخيص Starter أو Pro أو Business فيُفعَّل عبر الإنترنت/);
    expect(l['ku-arab']!.description).toMatch(/بەبێ ئینتەرنێت کار دەکات؛ مۆڵەتی Starter، Pro یان Business یەک جار بە ئینتەرنێت چالاک دەکرێت/);
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
