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

describe('the release notes of 1.3.0 (kept as shipped)', () => {
  const notes = read('apps/desktop/release-notes/1.3.0.md');
  const section = (lang: 'ar' | 'en' | 'ku') => new RegExp(`^::: ${lang}\\n([\\s\\S]*?)^:::$`, 'm').exec(notes)?.[1] ?? '';

  it('has notes in Arabic, English and Kurdish', () => {
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).trim().length).toBeGreaterThan(300);
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
  });

  it('says a Starter licence needs 1.3.0 or later, and to update every PC before entering the key', () => {
    expect(section('en')).toContain("**A Starter licence needs Qasa ERP 1.3.0 or later.** Earlier versions don't accept its key: update every PC first, then enter the key in **Plan & license**.");
    expect(section('ar')).toContain('**ترخيص Starter يحتاج قاصة ERP 1.3.0 أو أحدث.** الإصدارات الأقدم لا تقبل مفتاحه: حدّث كل الحواسيب أولاً، ثم أدخل المفتاح في **الخطة والترخيص**.');
    expect(section('ku')).toContain('**مۆڵەتی Starter پێویستی بە قاسە ERP 1.3.0 یان نوێتر هەیە.** وەشانە کۆنترەکان کلیلەکەی وەرناگرن: سەرەتا هەموو کۆمپیوتەرەکان نوێ بکەرەوە، پاشان کلیلەکە لە **پلان و مۆڵەت** داخڵ بکە.');
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
  });

  it('upgrades no company file in 1.3.0, so it has no "Before you update" warning', () => {
    expect(notes).not.toMatch(/Before you update|قبل التحديث|پێش نوێکردنەوە/);
    expect(notes).not.toMatch(/company file is upgraded|يُرقّى ملف الشركة|فایلی کۆمپانیا بەرز دەکرێتەوە/);
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

  it('is 1.4.0, the same in the app, the core and the lock file, with a notes file that has Arabic, English and Kurdish', () => {
    expect(version).toBe('1.4.0');
    expect(read('packages/core/src/version.ts')).toContain(`APP_VERSION = '${version}'`);
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string }> };
    expect(lock.packages['apps/desktop']?.version).toBe(version);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(notes, lang).toMatch(new RegExp(`^::: ${lang}\\n[\\s\\S]+?^:::$`, 'm'));
  });

  it('has the notes of 1.4.0 in Arabic, English and Kurdish, and Store text that names 1.4.0', () => {
    expect(notes).toMatch(/^\*\*Qasa ERP 1\.4\.0 for Windows\*\*: /);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).trim().length, lang).toBeGreaterThan(3000);
    expect(store['en-us'].releaseNotes).toMatch(/^Qasa ERP 1\.4\.0\. /);
    expect(store.ar.releaseNotes).toMatch(/^قاصة ERP 1\.4\.0\. /);
    expect(store['ku-arab'].releaseNotes).toMatch(/^قاسە ERP 1\.4\.0\. /);
    for (const lang of ['en-us', 'ar', 'ku-arab'] as const) expect(store[lang].releaseNotes, lang).not.toContain('1.3.0');
    // the three languages tell of the same things: the same headings and the same number of points under them
    const shape = (lang: 'ar' | 'en' | 'ku') => section(lang).split('\n').filter((l) => /^(### |- )/.test(l)).map((l) => l.slice(0, 2)).join('');
    expect(shape('ar')).toBe(shape('en'));
    expect(shape('ku')).toBe(shape('en'));
  });

  it('keeps each Store "What\'s new" within the 1500 characters Partner Center takes, and each feature within 200', () => {
    for (const lang of ['en-us', 'ar', 'ku-arab'] as const) {
      expect(store[lang].releaseNotes.length).toBeLessThanOrEqual(1500);
      expect(store[lang].features.length).toBeLessThanOrEqual(20);
      for (const feature of store[lang].features) expect(feature.length).toBeLessThanOrEqual(200);
    }
  });

  it('says plainly that 1.3 cannot open a company file 1.4 has upgraded, so every PC and the Store version are updated', () => {
    // why: 1.4 adds migration 13 (the item's purchase price, the vouchers that wait for approval), and an app refuses a newer file
    const db = read('packages/server/src/db.ts');
    expect(db).toContain('{ sql: V13, mysql: { tables: true, steps: () => V13_MYSQL_STEPS } }\n];');
    expect(db).toContain("if (version > app) throw new AppError(409, 'database_newer', { version, app });");
    expect(section('en')).toContain('### Before you update\n- **The company file is upgraded to a new version.** A copy of it is kept beside it before the update. Qasa ERP 1.3 cannot open a file that 1.4 has upgraded, so update every PC that opens the same company, and the Microsoft Store version too.');
    expect(section('ar')).toContain('### قبل التحديث\n- **يُرقّى ملف الشركة إلى إصدار جديد.** تُحفظ نسخة منه بجانبه قبل التحديث. لا يفتح قاصة ERP 1.3 ملفاً رقّاه الإصدار 1.4، فحدّث كل حاسوب يفتح الشركة نفسها، ونسخة متجر Microsoft أيضاً.');
    expect(section('ku')).toContain('### پێش نوێکردنەوە\n- **فایلی کۆمپانیا بەرز دەکرێتەوە بۆ وەشانێکی نوێ.** پێش نوێکردنەوە کۆپییەکی لە تەنیشتی دەپارێزرێت. قاسە ERP 1.3 فایلێک ناکاتەوە کە 1.4 بەرزی کردبێتەوە');
    // before the list of what is new, in each language
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).indexOf('1.3'), lang).toBeLessThan(section(lang).indexOf('0.1.8'));
    expect(store['en-us'].releaseNotes).toContain('The company file is upgraded: update every PC that opens it.');
    expect(store.ar.releaseNotes).toContain('يُرقّى ملف الشركة: حدّث كل حاسوب يفتحه.');
    expect(store['ku-arab'].releaseNotes).toContain('فایلی کۆمپانیا بەرز دەکرێتەوە: هەموو کۆمپیوتەرەکان نوێ بکەرەوە.');
  });

  it('tells of Cash or Credit on the sales invoice and at the till, one way for a sale, with the words the buttons carry', () => {
    const words = read('apps/web/src/i18n.ts');
    expect(words).toContain("payCash: ['نقداً', 'Cash', 'نەقد']");
    expect(words).toContain("payCredit: ['آجل', 'On credit', 'قەرز']");
    expect(read('apps/web/src/i18n/sales14.ts')).toContain("'A sale is either paid now or on credit as a whole, never part one and part the other.'");
    expect(read('apps/web/src/pages/Pos.tsx')).toContain("t('s14_creditNeedsCustomer')");
    expect(section('en')).toContain('a sales invoice and a sale at the till are paid one of two ways: **Cash** (paid now) or **On credit** (the whole sale goes on the customer\'s account as a debt). A credit sale needs a customer, and a sale is never part cash and part credit.');
    expect(section('ar')).toContain('**نقداً** (يُدفع الآن) أو **آجل** (يُسجَّل البيع كله ديناً على حساب الزبون). البيع الآجل يحتاج زبوناً، ولا يُقسم البيع بين النقد والآجل.');
    expect(section('ku')).toContain('**نەقد** (ئێستا دەدرێت) یان **قەرز** (هەموو فرۆشتنەکە وەک قەرز لەسەر کڕیار تۆمار دەکرێت). فرۆشتن بە قەرز پێویستی بە کڕیار هەیە');
    // the card and wallet row is gone from the till: said as a change, and no longer offered in the Store listing
    expect(section('en')).toContain('**The till offers Cash and Credit only.** The card and wallet row is gone from the point of sale. Sales paid by card or wallet before 1.4 still show, print, return and count in shift reports and the end-of-day close.');
    expect(section('ar')).toContain('**نقطة البيع تعرض نقداً وآجل فقط.** أُزيل صف البطاقة والمحافظ من نقطة البيع.');
    expect(section('ku')).toContain('**خاڵی فرۆشتن تەنها نەقد و قەرز پیشان دەدات.** ڕیزی کارت و جزدان لە خاڵی فرۆشتن لابرا.');
    expect(store['en-us'].releaseNotes).toContain('Sales invoices and the till: Cash or Credit only, one per sale; credit needs a customer. Card and wallets are gone from the till.');
    expect(store.ar.releaseNotes).toContain('فاتورة المبيعات ونقطة البيع: الدفع نقداً أو آجل فقط، بطريقة واحدة لكل بيع؛ البيع الآجل يحتاج زبوناً، وأُزيل صف البطاقة والمحافظ من نقطة البيع.');
    expect(store['ku-arab'].releaseNotes).toContain('پسوولەی فرۆشتن و خاڵی فرۆشتن: تەنها نەقد یان قەرز، یەکێک بۆ هەر فرۆشتنێک؛ قەرز پێویستی بە کڕیار هەیە. کارت و جزدان لە خاڵی فرۆشتن لابران.');
    for (const lang of ['en-us', 'ar', 'ku-arab'] as const) {
      const lines = [store[lang].description, ...store[lang].features].join('\n');
      expect(lines, lang).not.toMatch(/FIB|ZainCash|Qi Card|زين كاش|كي كارد|زەین کاش|کی کارد/);
    }
    expect(store['en-us'].description).toContain('• At the point of sale each sale is paid in cash or goes on credit, on the customer’s account; a credit sale needs a customer.');
    expect(store['en-us'].features).toContain('Sales and purchase invoices paid by Cash or Credit, returns, and the amount in words');
  });

  it('tells of Receive payment and Pay supplier with the balance before and after, and of the balance printed on the receipt voucher', () => {
    const words = read('apps/web/src/i18n/sales14.ts');
    expect(words).toContain("s14_receive: ['قبض دفعة', 'Receive payment', 'وەرگرتنی پارە']");
    expect(words).toContain("s14_paySupplier: ['دفع للمجهز', 'Pay supplier', 'پارەدان بە دابینکەر']");
    expect(words).toContain("s14_balanceBefore: ['الرصيد قبل', 'Balance before', 'ڕەسیدی پێشوو']");
    expect(words).toContain("s14_balanceAfter: ['المتبقي بعد', 'Remaining after', 'ڕەسیدی ماوە']");
    // where the form opens from: the customer or supplier, a credit invoice, the vouchers list
    for (const page of ['Parties', 'Invoices', 'Entries']) expect(read(`apps/web/src/pages/${page}.tsx`), page).toContain('<QuickVoucherButton ');
    const print = read('apps/web/src/i18n/print14.ts');
    expect(print).toContain("pd_h_previousBalance: ['الرصيد السابق', 'Previous balance', 'ڕەسیدی پێشوو']");
    expect(print).toContain("pd_h_remainingBalance: ['الرصيد المتبقي', 'Remaining balance', 'ڕەسیدی ماوە']");
    expect(section('en')).toContain('**Receive payment and Pay supplier:** a short form takes money from a customer or pays a supplier, and shows the balance before and what remains after. Open it from the customer or supplier, from a credit invoice, or from the vouchers list.');
    expect(section('ar')).toContain('**قبض دفعة ودفع للمجهز:** نموذج قصير تقبض به من الزبون أو تدفع به للمجهز، ويعرض الرصيد قبل الدفعة والمتبقي بعدها.');
    expect(section('ku')).toContain('**وەرگرتنی پارە و پارەدان بە دابینکەر:** فۆرمێکی کورت کە پارە لە کڕیار وەردەگریت یان بە دابینکەر دەدەیت، و ڕەسیدی پێشوو و ڕەسیدی ماوە پیشان دەدات.');
    expect(section('en')).toContain('it prints the customer\'s **Previous balance**, the amount received and the **Remaining balance**.');
    expect(section('ar')).toContain('يُطبع عليه **الرصيد السابق** للزبون والمبلغ المقبوض و**الرصيد المتبقي**.');
    expect(section('ku')).toContain('**ڕەسیدی پێشوو**ی کڕیار، بڕی پارەی وەرگیراو و **ڕەسیدی ماوە**ی لەسەر چاپ دەکرێت.');
    expect(store['en-us'].releaseNotes).toContain('Receive payment and Pay supplier: a short form from the customer or supplier, the invoice or the vouchers list, with the balance before and after. The receipt voucher prints the previous balance, amount received and remaining balance.');
    expect(store.ar.releaseNotes).toContain('«قبض دفعة» و«دفع للمجهز»: نموذج قصير من الزبون أو المجهز أو الفاتورة الآجلة أو قائمة السندات، يعرض الرصيد قبل الدفعة وبعدها. سند القبض المطبوع يحمل الرصيد السابق والمبلغ المقبوض والرصيد المتبقي.');
    expect(store['ku-arab'].releaseNotes).toContain('«وەرگرتنی پارە» و «پارەدان بە دابینکەر»: فۆرمێکی کورت لە کڕیار، دابینکەر، پسوولە یان لیستی سەنەدەکانەوە، بە ڕەسیدی پێشوو و ڕەسیدی ماوە. سەنەدی وەرگرتن ڕەسیدی پێشوو، بڕی پارەی وەرگیراو و ڕەسیدی ماوە چاپ دەکات.');
  });

  it('tells of the customers and suppliers lists that say who owes what, in the words the lists carry', () => {
    const words = read('apps/web/src/i18n/shell14.ts');
    expect(words).toContain("s14_owesUs: ['عليه لنا', 'Owes us', 'قەرزارمانە']");
    expect(words).toContain("s14_weOwe: ['له علينا', 'We owe him', 'قەرزاری ئەوین']");
    expect(words).toContain("s14_settled: ['لا رصيد', 'Nothing owed', 'بێ قەرز']");
    expect(words).toContain("s14_oweCustomer: ['لنا على الزبائن', 'Customers owe us', 'کڕیاران قەرزارمانن']");
    expect(words).toContain("s14_oweSupplier: ['للمجهزين علينا', 'We owe suppliers', 'قەرزاری دابینکەرانین']");
    expect(words).toContain("s14_onlyOwingCustomers: ['المدينون فقط', 'Only those who owe', 'تەنها قەرزارەکان']");
    expect(words).toContain("s14_sortDebt: ['الأكبر ديناً أولاً', 'Biggest debt first', 'زۆرترین قەرز لە پێشەوە']");
    expect(section('en')).toContain('the Customers and Suppliers lists say **Owes us**, **We owe him** or **Nothing owed** beside each name, with the totals above the list (**Customers owe us**, **We owe suppliers**). Show **Only those who owe**, and sort by **Biggest debt first**.');
    expect(section('ar')).toContain('**عليه لنا** أو **له علينا** أو **لا رصيد**، والمجاميع أعلى القائمة (**لنا على الزبائن**، **للمجهزين علينا**). اعرض **المدينون فقط**، ورتّب **الأكبر ديناً أولاً**.');
    expect(section('ku')).toContain('**قەرزارمانە**، **قەرزاری ئەوین** یان **بێ قەرز**، و کۆکان لە سەرەوەی لیستەکەن (**کڕیاران قەرزارمانن**، **قەرزاری دابینکەرانین**). **تەنها قەرزارەکان** پیشان بدە، و بە **زۆرترین قەرز لە پێشەوە** ڕیزیان بکە.');
    expect(store['en-us'].releaseNotes).toContain('Customers and Suppliers lists say who owes what in words, with totals and filters.');
    expect(store.ar.releaseNotes).toContain('قائمتا الزبائن والمجهزين تكتبان من عليه ومن له بالكلمات، مع المجاميع والتصفية.');
    expect(store['ku-arab'].releaseNotes).toContain('لیستی کڕیاران و دابینکەران بە وشە دەڵێن کێ قەرزارە، لەگەڵ کۆ و «تەنها قەرزارەکان».');
  });

  it('names the print designs as the gallery does, and the company logo as part of the paid plans, a saved one still printing', () => {
    const words = read('apps/web/src/i18n/print14.ts');
    expect(words).toContain("pd_g_classic: ['الافتراضي', 'Standard', 'بنەڕەتی']");
    expect(words).toContain("pd_g_modernLines: ['حديث بخطوط', 'Modern with lines', 'مۆدێرن بە هێڵ']");
    expect(words).toContain("pd_g_ledger: ['دفتري كلاسيكي', 'Classic ledger', 'دەفتەری کلاسیکی']");
    expect(words).toContain("pd_g_halfPage: ['نصف صفحة (A5)', 'Half page (A5)', 'نیو پەڕە (A5)']");
    expect(words).toContain("pd_g_receipt80: ['إيصال حراري 80 مم', '80 mm thermal receipt', 'وەسڵی گەرمی 80 ملم']");
    expect(section('en')).toContain('**Print design** opens with a gallery of ready-made designs beside a live preview: **Standard**, **Modern with lines**, **Classic ledger** (black and white, a fully ruled table, saves ink), **Modern**, **Half page (A5)** and **80 mm thermal receipt**.');
    expect(section('ar')).toContain('**الافتراضي**، **حديث بخطوط**، **دفتري كلاسيكي** (أبيض وأسود، جدول مسطّر كاملاً، يوفّر الحبر)، **حديث**، **نصف صفحة (A5)** و**إيصال حراري 80 مم**.');
    expect(section('ku')).toContain('**بنەڕەتی**، **مۆدێرن بە هێڵ**، **دەفتەری کلاسیکی** (ڕەش و سپی، خشتەی تەواو هێڵکراو، مەرەکەب کەم بەکاردەهێنێت)، **مۆدێرن**، **نیو پەڕە (A5)** و **وەسڵی گەرمی 80 ملم**.');
    // the logo: Starter has it too, so it is for the paid plans, never "(Pro)"; a logo saved before stays
    const plans = read('packages/core/src/plans.ts');
    expect(/STARTER_FEATURES: readonly Feature\[\] = \[([^\]]*)\]/.exec(plans)?.[1]).toContain("'companyLogo'");
    expect(plans).toContain("free: { id: 'free', limits: { companies: 1, users: 1, warehouses: 1 }, features: [] }");
    expect(words).toContain("'Your logo, saved earlier, keeps printing. Changing it needs a paid plan.'");
    expect(section('en')).toContain('**Company logo on printed papers (paid plans):** adding or changing the logo is part of Starter, Pro and Business. A logo saved before 1.4 keeps printing on every plan.');
    expect(section('ar')).toContain('**شعار الشركة على المطبوعات (الخطط المدفوعة):** إضافة الشعار أو تغييره من مزايا Starter وPro وBusiness. والشعار المحفوظ قبل 1.4 يبقى يُطبع في كل الخطط.');
    expect(section('ku')).toContain('**لۆگۆی کۆمپانیا لەسەر چاپکراوەکان (پلانەکانی بە پارە):** زیادکردن یان گۆڕینی لۆگۆ بەشێکە لە Starter، Pro و Business. ئەو لۆگۆیەی پێش 1.4 پاشەکەوت کراوە لە هەموو پلانەکاندا هەر چاپ دەکرێت.');
    expect(store['en-us'].releaseNotes).toContain('New print designs (Modern with lines, Classic ledger, Half page A5, 80 mm) in a gallery with a live preview, and more switches. Company logo on printed papers (paid plans); a logo saved earlier keeps printing.');
    expect(store.ar.releaseNotes).toContain('شعار الشركة على المطبوعات (الخطط المدفوعة)؛ والشعار المحفوظ سابقاً يبقى يُطبع.');
    expect(store['ku-arab'].releaseNotes).toContain('لۆگۆی کۆمپانیا لەسەر چاپکراوەکان (پلانەکانی بە پارە)؛ لۆگۆی پێشوو هەر چاپ دەکرێت.');
    expect(store['en-us'].description).toContain('and your logo (paid plans). Choose a design for each document from a gallery with a live preview (standard, modern with lines, classic ledger, modern, half page A5 or an 80 mm thermal receipt)');
    expect(store.ar.description).toContain('وشعارك (الخطط المدفوعة). اختر تصميماً لكل مستند من معرض بمعاينة مباشرة');
    expect(store['ku-arab'].description).toContain('و لۆگۆکەت (پلانەکانی بە پارە). بۆ هەر بەڵگەیەک دیزاینێک لە پێشانگایەک بە پێشبینینی ڕاستەوخۆ هەڵبژێرە');
    for (const lang of ['en-us', 'ar', 'ku-arab'] as const) {
      expect(store[lang].features.filter((f) => /logo|شعار|لۆگۆ/.test(f)).every((f) => /\((paid plans|الخطط المدفوعة|پلانەکانی بە پارە)\)$/.test(f)), lang).toBe(true);
    }
    expect(read('README.md')).toContain('| Your company logo on printed papers | | ✓ | ✓ | ✓ |');
  });

  it('tells of the item form, the Market / Supermarket business type and the scale labels read at the till', () => {
    const words = read('apps/web/src/i18n/items14.ts');
    expect(words).toContain("it_name: ['اسم المادة', 'Item name', 'ناوی کاڵا']");
    expect(words).toContain("it_purchasePrice: ['سعر الشراء', 'Purchase price', 'نرخی کڕین']");
    expect(words).toContain("un_showAll: ['عرض كل الوحدات', 'Show all units', 'هەموو یەکەکان پیشان بدە']");
    expect(words).toContain("bt_market: ['ماركت / سوبرماركت', 'Market / Supermarket', 'مارکێت / سوپەرمارکێت']");
    expect(words).toContain('give the item a 7-digit barcode starting with 2');
    expect(section('en')).toContain('one **Item name** for all three languages (an item can still have a different name in each), a picture when you add the item, the **Purchase price** beside the sale price with the profit');
    expect(section('en')).toContain('with **Show all units** for the rest.');
    expect(section('ar')).toContain('**اسم المادة** واحد للغات الثلاث (ويمكن أن يبقى للمادة اسم مختلف في كل لغة)، وصورة عند إضافة المادة، و**سعر الشراء** بجانب سعر البيع مع الربح');
    expect(section('ku')).toContain('یەک **ناوی کاڵا** بۆ هەر سێ زمانەکە (کاڵا هێشتا دەتوانێت لە هەر زمانێکدا ناوێکی جیاوازی هەبێت)، وێنە لە کاتی زیادکردنی کاڵادا، **نرخی کڕین** لە تەنیشت نرخی فرۆشتن لەگەڵ قازانج');
    expect(section('en')).toContain('**Market / Supermarket:** a new business type, with expiry dates switched on and the grocery starter list. For items sold by weight, give the item a 7-digit barcode starting with 2: the till then reads the weight from the label the scale prints.');
    expect(section('ar')).toContain('**ماركت / سوبرماركت:** نوع نشاط جديد');
    expect(section('ar')).toContain('اجعل باركود المادة 7 أرقام تبدأ بـ 2، فتقرأ نقطة البيع الوزن من الملصق الذي يطبعه الميزان.');
    expect(section('ku')).toContain('**مارکێت / سوپەرمارکێت:** جۆرێکی نوێی کار');
    expect(section('ku')).toContain('بارکۆدی کاڵاکە بکە بە 7 ژمارە کە بە 2 دەست پێدەکات، ئینجا خاڵی فرۆشتن کێشەکە لەو لێبڵە دەخوێنێتەوە کە تەرازووەکە چاپی دەکات.');
    expect(store['en-us'].releaseNotes).toContain('Item form: one name, a picture when adding, purchase price beside sale price with the profit, clearer units. Market / Supermarket business type, with scale labels that carry the weight to the till.');
    expect(store.ar.releaseNotes).toContain('نوع النشاط الجديد «ماركت / سوبرماركت»، مع ملصقات الميزان التي تحمل الوزن إلى نقطة البيع.');
    expect(store['ku-arab'].releaseNotes).toContain('جۆری کاری «مارکێت / سوپەرمارکێت»، بە لێبڵی تەرازوو کە کێش دەگەیەنێتە خاڵی فرۆشتن.');
  });

  it('says vouchers wait for approval only when the company switches it on, and who approves them', () => {
    // off unless switched on: the setting is on only when it was written as '1'
    expect(read('packages/server/src/journal.ts')).toContain("return readSetting(db, NEED_APPROVAL) === '1';");
    expect(read('apps/web/src/pages/Users.tsx')).toContain('<VoucherApprovalSetting />');
    expect(read('apps/web/src/i18n/sales14.ts')).toContain("s14_needTitle: ['السندات تحتاج موافقة', 'Vouchers need approval', 'سەنەدەکان پێویستیان بە پەسەندکردنە']");
    expect(read('apps/web/src/i18n.ts')).toContain("role_approver: ['المصادق', 'Approver', 'پەسەندکەر']");
    expect(section('en')).toContain('**Vouchers need approval** (Settings → **Users**; off unless you switch it on): vouchers made by users who may not approve wait, outside every balance, until a user with the **Approver** role or an admin approves them, or rejects them with a reason.');
    expect(section('ar')).toContain('**السندات تحتاج موافقة** (الإعدادات ← **المستخدمون**؛ متوقفة إلى أن تفعّلها): سندات من ليست له صلاحية المصادقة تنتظر، خارج كل الأرصدة، حتى يوافق عليها مستخدم له دور **المصادق** أو مدير، أو يرفضها مع السبب.');
    expect(section('ku')).toContain('**سەنەدەکان پێویستیان بە پەسەندکردنە** (ڕێکخستنەکان ← **بەکارهێنەران**؛ ناچالاکە تا خۆت چالاکی نەکەیت)');
    expect(section('ku')).toContain('تا بەکارهێنەرێک بە ڕۆڵی **پەسەندکەر** یان بەڕێوەبەرێک پەسەندی بکات، یان بە هۆکارەوە ڕەتی بکاتەوە.');
    expect(store['en-us'].releaseNotes).toContain('Vouchers can wait for approval by an Approver (off unless switched on).');
    expect(store.ar.releaseNotes).toContain('السندات يمكن أن تنتظر موافقة مستخدم له دور المصادق (متوقفة إلى أن تفعّلها).');
    expect(store['ku-arab'].releaseNotes).toContain('سەنەد دەتوانێت چاوەڕێی پەسەندکردنی «پەسەندکەر» بێت (بە بنەڕەت ناچالاکە).');
  });

  it('says cashiers do not see cost or profit, each person sees only the buttons they may use, and the dollar rate is at the top', () => {
    expect(read('apps/web/src/nav.ts')).toContain("ownWith: 'sales', ownKey: 's14_myVouchers'");
    expect(read('apps/web/src/i18n/sales14.ts')).toContain("s14_myVouchers: ['سنداتي', 'My vouchers', 'سەنەدەکانم']");
    expect(read('apps/web/src/may.ts')).toContain('is offered only when its action is one the server would accept from this person');
    expect(read('apps/web/src/industry/HeaderRate.tsx')).toContain("today's dollar rate at the top of the window, beside the person's name");
    expect(section('en')).toContain("**Cashiers don't see cost or profit:** a user without the stock, purchases or admin permission sees no purchase price, average cost, stock value or profit.");
    expect(section('en')).toContain('their vouchers page is **My vouchers**, with only the vouchers they prepared.');
    expect(section('ar')).toContain('**الكاشير لا يرى الكلفة ولا الربح:** المستخدم الذي ليست له صلاحية المخزن أو المشتريات أو المدير لا يرى سعر الشراء ولا متوسط الكلفة ولا قيمة المخزون ولا الربح.');
    expect(section('ar')).toContain('وصفحة السندات عنده **سنداتي**');
    expect(section('ku')).toContain('**کاشێر تێچوو و قازانج نابینێت:** ئەو بەکارهێنەرەی دەسەڵاتی کۆگا، کڕین یان بەڕێوەبەری نییە نرخی کڕین، تێکڕای تێچوو، بەهای کۆگا و قازانج نابینێت.');
    expect(section('ku')).toContain('پەڕەی سەنەدەکانی **سەنەدەکانم**ە');
    expect(section('en')).toContain('**Only the buttons you may use:** a menu row, tile or button shows only when the person signed in may do what it does.');
    expect(section('en')).toContain('**The dollar rate at the top of the window,** beside your name.');
    expect(section('ar')).toContain('**سعر الدولار أعلى النافذة،** بجانب اسمك.');
    expect(section('ku')).toContain('**نرخی دۆلار لە سەرەوەی پەنجەرەکە،** لە تەنیشت ناوەکەت.');
    expect(store['en-us'].releaseNotes).toContain('Cashiers do not see cost or profit; users see only the buttons they may use. Dollar rate in the top bar; item pictures at the till.');
    expect(store.ar.releaseNotes).toContain('الكاشير لا يرى الكلفة ولا الربح، وكل مستخدم يرى الأزرار التي يحق له استعمالها فقط. سعر الدولار في الشريط العلوي، ونقطة البيع تعرض صور المواد.');
    expect(store['ku-arab'].releaseNotes).toContain('کاشێر تێچوو و قازانج نابینێت؛ هەر کەس تەنها ئەو دوگمانە دەبینێت کە مافی هەیە. نرخی دۆلار لە شریتی سەرەوە؛ وێنەی کاڵا لە خاڵی فرۆشتن.');
  });

  it('tells of the Windows app: the question at closing, the printers page and where the data is, in the words the app shows', () => {
    const desktop = read('apps/desktop/src/texts.ts');
    expect(desktop).toContain("closeAsk: ['هل تحفظ نسخة احتياطية قبل الإغلاق؟', 'Back up before closing?', 'پێش داخستن باکئەپ بکرێت؟']");
    expect(desktop).toContain("closeAskBackup: ['احفظ نسخة وأغلق', 'Back up and close', 'باکئەپ بکە و دایبخە']");
    expect(desktop).toContain("closeAskClose: ['أغلق دون نسخة', 'Close without backup', 'بەبێ باکئەپ دایبخە']");
    expect(desktop).toContain("closeAskNever: ['لا تسألني مرة أخرى', 'Don’t ask again', 'جارێکی تر مەپرسە']");
    const words = read('apps/web/src/i18n/shell14.ts');
    expect(words).toContain("s14_prnDefault: ['الافتراضية في ويندوز', 'Windows default', 'بنەڕەتیی ویندۆز']");
    expect(words).toContain("s14_dataOfficeNoName: ['البيانات على حاسوب المكتب', 'Data is on the office PC', 'داتا لەسەر کۆمپیوتەری نووسینگەیە']");
    expect(section('en')).toContain('closing asks **Back up before closing?** with **Back up and close**, **Close without backup** or Cancel, and **Don’t ask again**. Switch it in Settings → **Backups**.');
    expect(section('ar')).toContain('**هل تحفظ نسخة احتياطية قبل الإغلاق؟** مع **احفظ نسخة وأغلق** أو **أغلق دون نسخة** أو إلغاء، ومع **لا تسألني مرة أخرى**. تغيّره من الإعدادات ← **النسخ الاحتياطية**.');
    expect(section('ku')).toContain('**پێش داخستن باکئەپ بکرێت؟** لەگەڵ **باکئەپ بکە و دایبخە**، **بەبێ باکئەپ دایبخە** یان پاشگەزبوونەوە، و لەگەڵ **جارێکی تر مەپرسە**. لە ڕێکخستنەکان ← **باکئەپەکان** دەیگۆڕیت.');
    expect(section('en')).toContain('Settings → **Printers** lists the printers on this computer, marks the **Windows default** and which are ready or offline, and suggests a printer for each kind of paper. They are suggestions: check them and print a test page.');
    expect(section('ar')).toContain('الإعدادات ← **الطابعات** تعرض طابعات هذا الحاسوب، وتعلّم **الافتراضية في ويندوز**');
    expect(section('ku')).toContain('ڕێکخستنەکان ← **چاپکەرەکان** چاپکەرەکانی ئەم کۆمپیوتەرە پیشان دەدات، **بنەڕەتیی ویندۆز**');
    expect(section('en')).toContain('a PC connected to the office PC now says **Data is on the office PC** with its name');
    expect(section('ar')).toContain('الحاسوب المتصل بحاسوب المكتب يقول الآن **البيانات على حاسوب المكتب** مع اسمه');
    expect(section('ku')).toContain('ئێستا دەڵێت **داتا لەسەر کۆمپیوتەری نووسینگەیە** لەگەڵ ناوەکەی');
    expect(store['en-us'].releaseNotes).toContain('On Windows: closing asks to back up, Printers finds the Windows default and suggests a printer per paper, and a PC connected to the office PC says where the data is.');
    expect(store.ar.releaseNotes).toContain('في ويندوز: يسألك البرنامج عن نسخة احتياطية عند الإغلاق، والإعدادات ← الطابعات تعرف الطابعة الافتراضية في ويندوز وتقترح طابعة لكل نوع ورق، والحاسوب المتصل بحاسوب المكتب يقول أين البيانات.');
    expect(store['ku-arab'].releaseNotes).toContain('لە ویندۆز: لە داخستندا دەربارەی باکئەپ دەپرسێت، «چاپکەرەکان» بنەڕەتیی ویندۆز دەدۆزێتەوە و بۆ هەر پەڕەیەک چاپکەرێک پێشنیار دەکات، و کۆمپیوتەری بەستراو بە کۆمپیوتەری نووسینگە دەڵێت داتا لە کوێیە.');
  });

  it('writes the Kurdish texts with the app\'s accounting words, and says the wording was revised', () => {
    const ku = section('ku') + store['ku-arab'].releaseNotes;
    for (const word of ['ڕەسید', 'قەرز', 'نەقد', 'قاسە', 'سەنەد', 'پسوولە', 'وەسڵ', 'باکئەپ', 'کۆگا']) expect(ku, word).toContain(word);
    for (const word of ['قەید', 'ڕەسید', 'تەرحیل', 'جەرد', 'نەقد', 'قەرز', 'قاسە', 'وەسڵ']) {
      for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang), `${lang} ${word}`).toContain(word);
    }
    expect(store['en-us'].releaseNotes).toContain('Kurdish wording revised to accountants’ terms.');
    expect(store.ar.releaseNotes).toContain('روجعت الصياغة الكردية إلى مصطلحات المحاسبين.');
    expect(store['ku-arab'].releaseNotes).toContain('وشەکانی کوردی کراون بە زاراوەی ژمێریاران.');
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
    expect(store['ku-arab'].description).toContain('داخستنی ساڵ (پلانەکانی بە پارە)،');
    expect(store['ku-arab'].description).toContain('• دەرمانخانە (پلانەکانی بە پارە):');
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
