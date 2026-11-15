// What the release ships and says: the build and workflow settings, the Store listing and the notices.
import { existsSync, readFileSync } from 'node:fs';
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

  it('states every limit of the free month as the app sets it: up to 3 companies on the PC and 3 phones for each company', () => {
    // why: Store policy 10.8.4 wants every limit of a trial in the description (a submission was refused for it once)
    const plans = read('packages/core/src/plans.ts');
    expect(plans).toContain("pro: { id: 'pro', limits: { companies: 3,");
    expect(plans).toContain('limits = { ...PLANS.business.limits, companies: PLANS.pro.limits.companies };');
    // the phones' limit lives in the private Pro module (present in Meroxis' checkout and the release build)
    const phone = 'pro/src/phone/phone.ts';
    if (existsSync(join(root, phone))) expect(read(phone)).toContain("return plan === 'business' && source !== 'trial' ? null : 3;");
    expect(en.description).toContain('During that month you can keep up to 3 companies on the PC and pair up to 3 phones with each company (on the office Wi-Fi, as Qasa Relay is not part of the free month), and use everything else: unlimited users and warehouses');
    expect(ar.description).toContain('خلال هذا الشهر يمكن أن يكون على الحاسوب حتى 3 شركات، وأن تربط بكل شركة حتى 3 هواتف (على Wi-Fi المكتب، لأن Qasa Relay ليس من الشهر المجاني)، وتستخدم كل ما سوى ذلك: مستخدمون ومخازن بلا حد');
    expect(ku.description).toContain('لەم مانگەدا دەتوانیت تا 3 کۆمپانیات لەسەر کۆمپیوتەرەکە هەبێت و تا 3 مۆبایل بە هەر کۆمپانیایەکەوە ببەستیتەوە (لەسەر Wi-Fi ی نووسینگە، چونکە Qasa Relay لە مانگی بەخۆڕاییدا نییە)، و هەموو شتێکی تریش بەکاردەهێنیت: بەکارهێنەر و کۆگای بێسنوور');
  });

  it('names the phones\' place in Settings as the app has it, and how many phones each plan pairs', () => {
    // the phones card sits in the Office network section: there is no Phones section
    const settings = read('apps/web/src/pages/Settings.tsx');
    expect(settings).toContain("{ id: 'network', icon: 'branch', name: 'netTitle'");
    expect(settings).toContain('<OfficeNetworkCard /><PhonesCard /><DatabaseCard />');
    expect(settings).not.toMatch(/\{ id: 'phones'/);
    expect(read('apps/web/src/i18n.ts')).toContain("netTitle: ['شبكة المكتب', 'Office network', 'تۆڕی نووسینگە']");
    expect(read('apps/web/src/i18n/phone.ts')).toContain("ph_title: ['الهواتف (تطبيق قاصة)', 'Phones (Qasa app)', 'مۆبایلەکان (ئەپی قاسە)']");
    expect(en.description).toContain('pair phones in Settings → Office network → Phones (Qasa app). Up to 3 phones per company on Starter and Pro, without a limit on Business; on Starter the phones work on the office Wi-Fi only.');
    expect(ar.description).toContain('واربط الهواتف من الإعدادات ← شبكة المكتب ← الهواتف (تطبيق قاصة). حتى 3 هواتف لكل شركة في Starter وPro، وبلا حد في Business؛ وفي Starter تعمل الهواتف على Wi-Fi المكتب فقط.');
    expect(ku.description).toContain('مۆبایلەکان لە ڕێکخستنەکان ← تۆڕی نووسینگە ← مۆبایلەکان (ئەپی قاسە) ببەستەوە. تا 3 مۆبایل بۆ هەر کۆمپانیایەک لە Starter و Pro، و بێ سنوور لە Business؛ لە Starter مۆبایلەکان تەنها لەسەر Wi-Fi ی نووسینگە کار دەکەن.');
    for (const l of [en, ar, ku]) {
      expect([l.description, l.releaseNotes, ...l.features].join('\n')).not.toMatch(/Settings → Phones|الإعدادات ← الهواتف|ڕێکخستنەکان ← مۆبایلەکان/);
    }
  });

  it('never promises OneDrive: the app still shows it as coming soon, as no build signs in to it yet', () => {
    // a service shows as coming soon in a build without its client ID; the release build has none for OneDrive yet (no
    // QASA_MS_CLIENT_ID secret): name OneDrive here only once a release signs in to it
    expect(read('apps/web/src/pages/cloud-providers.ts')).toContain("state: configured[provider] === true ? 'connect' : 'soon'");
    expect(read('apps/web/src/i18n/cloud.ts')).toContain("cl_soon: ['{p}: قريباً', '{p}: coming soon', '{p}: بەم زووانە'],");
    for (const l of [en, ar, ku]) expect([l.shortDescription, l.description, l.releaseNotes, ...l.features].join('\n')).not.toContain('OneDrive');
  });

  it('ships no {{…}} placeholder: once the app is on the version its "What\'s new" names, that version\'s items are written', () => {
    const version = (JSON.parse(read('apps/desktop/package.json')) as { version: string }).version;
    const numbers = (v: string) => v.split('-')[0]!.split('.').map(Number);
    const older = (a: string, b: string) => {
      const [x, y] = [numbers(a), numbers(b)];
      const at = x.findIndex((n, i) => n !== y[i]);
      return at >= 0 && x[at]! < y[at]!;
    };
    for (const [lang, l] of Object.entries(listing.listings)) {
      const named = /^\S+ ERP (\d+\.\d+\.\d+(?:-[\w.]+)?)\./.exec(l.releaseNotes)?.[1] ?? '';
      expect(named, lang).toMatch(/^\d+\.\d+\.\d+/);
      if (named === version) expect(l.releaseNotes, lang).not.toMatch(/\{\{|\}\}/);
      // a stable release (a beta never goes to the Store) is never sent with the text of an older one, nor with a draft
      // left for a version number it did not take (1.5.0 instead of 1.4.3)
      if (!version.includes('-')) expect(older(named, version), `${lang}: the Store "What's new" names ${named}, the app is ${version}`).toBe(false);
    }
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

describe('the release notes of 1.4.0 (kept as shipped)', () => {
  const notes = read('apps/desktop/release-notes/1.4.0.md');
  const section = (lang: 'ar' | 'en' | 'ku') => new RegExp(`^::: ${lang}\\n([\\s\\S]*?)^:::$`, 'm').exec(notes)?.[1] ?? '';
  const listing = JSON.parse(read('apps/desktop/store-listing.json')) as {
    listings: Record<'en-us' | 'ar' | 'ku-arab', { releaseNotes: string; features: string[]; description: string }>;
  };

  const store = listing.listings;

  it('has the notes of 1.4.0 in Arabic, English and Kurdish', () => {
    expect(notes).toMatch(/^\*\*Qasa ERP 1\.4\.0 for Windows\*\*: /);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).trim().length, lang).toBeGreaterThan(3000);
    // the three languages tell of the same things: the same headings and the same number of points under them
    const shape = (lang: 'ar' | 'en' | 'ku') => section(lang).split('\n').filter((l) => /^(### |- )/.test(l)).map((l) => l.slice(0, 2)).join('');
    expect(shape('ar')).toBe(shape('en'));
    expect(shape('ku')).toBe(shape('en'));
  });

  it('says plainly that 1.3 cannot open a company file 1.4 has upgraded, so every PC and the Store version are updated', () => {
    // why: 1.4 adds migration 13 (the item's purchase price, the vouchers that wait for approval), and an app refuses a newer file
    const db = read('packages/server/src/db.ts');
    expect(db).toContain('{ sql: V13, mysql: { tables: true, steps: () => V13_MYSQL_STEPS } }');
    expect(db).toContain("if (version > app) throw new AppError(409, 'database_newer', { version, app });");
    expect(section('en')).toContain('### Before you update\n- **The company file is upgraded to a new version.** A copy of it is kept beside it before the update. Qasa ERP 1.3 cannot open a file that 1.4 has upgraded, so update every PC that opens the same company, and the Microsoft Store version too.');
    expect(section('ar')).toContain('### قبل التحديث\n- **يُرقّى ملف الشركة إلى إصدار جديد.** تُحفظ نسخة منه بجانبه قبل التحديث. لا يفتح قاصة ERP 1.3 ملفاً رقّاه الإصدار 1.4، فحدّث كل حاسوب يفتح الشركة نفسها، ونسخة متجر Microsoft أيضاً.');
    expect(section('ku')).toContain('### پێش نوێکردنەوە\n- **فایلی کۆمپانیا بەرز دەکرێتەوە بۆ وەشانێکی نوێ.** پێش نوێکردنەوە کۆپییەکی لە تەنیشتی دەپارێزرێت. قاسە ERP 1.3 فایلێک ناکاتەوە کە 1.4 بەرزی کردبێتەوە');
    // before the list of what is new, in each language
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).indexOf('1.3'), lang).toBeLessThan(section(lang).indexOf('0.1.8'));
  });

  it('tells of Cash or Credit on the sales invoice and at the till, one way for a sale, with the words the buttons carry', () => {
    const words = read('apps/web/src/i18n.ts');
    expect(words).toContain("payCash: ['نقداً', 'Cash', 'نەقد']");
    expect(words).toContain("payCredit: ['آجل', 'On credit', 'قەرز']");
    expect(read('apps/web/src/i18n/sales14.ts')).toContain("'A sale is either paid now or on credit as a whole, never part one and part the other.'");
    expect(read('apps/web/src/pages/Pos.tsx')).toContain("t('s14_creditNeedsCustomer')");
    expect(section('en')).toContain('a sales invoice and a sale at the till are paid one of two ways: **Cash** (paid now) or **On credit** (the whole sale goes on the customer’s account as a debt). A credit sale needs a customer, and a sale is never part cash and part credit.');
    expect(section('ar')).toContain('**نقداً** (يُدفع الآن) أو **آجل** (يُسجَّل البيع كله ديناً على حساب الزبون). البيع الآجل يحتاج زبوناً، ولا يُقسم البيع بين النقد والآجل.');
    expect(section('ku')).toContain('**نەقد** (ئێستا دەدرێت) یان **قەرز** (هەموو فرۆشتنەکە وەک قەرز لەسەر کڕیار تۆمار دەکرێت). فرۆشتن بە قەرز پێویستی بە کڕیار هەیە');
    // the card and wallet row is gone from the till: said as a change, and no longer offered in the Store listing
    expect(section('en')).toContain('**The till offers Cash and Credit only.** The card and wallet row is gone from the point of sale. Sales paid by card or wallet before 1.4 still show, print, return and count in shift reports and the end-of-day close.');
    expect(section('ar')).toContain('**نقطة البيع تعرض نقداً وآجل فقط.** أُزيل صف البطاقة والمحافظ من نقطة البيع.');
    expect(section('ku')).toContain('**خاڵی فرۆشتن تەنها نەقد و قەرز پیشان دەدات.** ڕیزی کارت و جزدان لە خاڵی فرۆشتن لابرا.');
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
    expect(section('en')).toContain('it prints the customer’s **Previous balance**, the amount received and the **Remaining balance**.');
    expect(section('ar')).toContain('يُطبع عليه **الرصيد السابق** للزبون والمبلغ المقبوض و**الرصيد المتبقي**.');
    expect(section('ku')).toContain('**ڕەسیدی پێشوو**ی کڕیار، بڕی پارەی وەرگیراو و **ڕەسیدی ماوە**ی لەسەر چاپ دەکرێت.');
  });

  it('tells of the customers and suppliers lists that say who owes what, in the words the lists carry', () => {
    const words = read('apps/web/src/i18n/shell14.ts');
    expect(words).toContain("s14_owesUs: ['عليه لنا', 'Owes us', 'قەرزارمانە']");
    expect(words).toContain("s14_weOwe: ['له علينا', 'We owe them', 'قەرزاری ئەوین']");
    expect(words).toContain("s14_settled: ['لا رصيد', 'Nothing owed', 'بێ قەرز']");
    expect(words).toContain("s14_oweCustomer: ['لنا على الزبائن', 'Customers owe us', 'کڕیاران قەرزارمانن']");
    expect(words).toContain("s14_oweSupplier: ['للمجهزين علينا', 'We owe suppliers', 'قەرزاری دابینکەرانین']");
    expect(words).toContain("s14_onlyOwingCustomers: ['المدينون فقط', 'Only those who owe', 'تەنها قەرزارەکان']");
    expect(words).toContain("s14_sortDebt: ['الأكبر ديناً أولاً', 'Biggest debt first', 'زۆرترین قەرز لە پێشەوە']");
    expect(section('en')).toContain('the Customers and Suppliers lists say **Owes us**, **We owe them** or **Nothing owed** beside each name, with the totals above the list (**Customers owe us**, **We owe suppliers**). Show **Only those who owe**, and sort by **Biggest debt first**.');
    expect(section('ar')).toContain('**عليه لنا** أو **له علينا** أو **لا رصيد**، والمجاميع أعلى القائمة (**لنا على الزبائن**، **للمجهزين علينا**). فعّل خيار **المدينون فقط**، ورتّب بحسب **الأكبر ديناً أولاً**.');
    expect(section('ku')).toContain('**قەرزارمانە**، **قەرزاری ئەوین** یان **بێ قەرز**، و کۆکان لە سەرەوەی لیستەکەن (**کڕیاران قەرزارمانن**، **قەرزاری دابینکەرانین**). **تەنها قەرزارەکان** پیشان بدە، و بە **زۆرترین قەرز لە پێشەوە** ڕیزیان بکە.');
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
  });

  it('says who sees cost in one rule (whoever keeps or reads the books; a sales-only user none of it), that each person sees only the buttons they may use, and that the dollar rate is at the top', () => {
    // the rule as the server has it: seesCost follows seesBooks (auth.ts), and the suppliers' ageing is refused without the books (brief.ts)
    expect(read('packages/server/src/auth.ts')).toContain("export const seesCost = (actor: Pick<Actor, 'permissions' | 'roles'>): boolean => seesBooks(actor);");
    expect(read('packages/server/src/brief.ts')).toContain("if (q.type === 'supplier' && !seesBooks(actorOf(req))) throw new AppError(403, 'forbidden');");
    expect(read('apps/web/src/nav.ts')).toContain("ownWith: 'sales', ownKey: 's14_myVouchers'");
    expect(read('apps/web/src/i18n/sales14.ts')).toContain("s14_myVouchers: ['سنداتي', 'My vouchers', 'سەنەدەکانم']");
    expect(read('apps/web/src/may.ts')).toContain('is offered only when its action is one the server would accept from this person');
    expect(read('apps/web/src/industry/HeaderRate.tsx')).toContain("today's dollar rate at the top of the window, beside the person's name");
    expect(section('en')).toContain('**Who sees cost and the books, one rule:** whoever keeps or reads the books also sees cost. Admins, Purchasing, Storekeepers, the accounting roles (Preparer, Checker, Approver) and Viewers see purchase prices, average cost, stock value, profit and the books.');
    expect(section('en')).toContain('A user with none of these roles (the Sales role alone, a cashier) sees no cost, profit, stock value or books: no journal, no company books, no expenses, nothing of what the safes and banks hold, and no ageing of what suppliers are owed;');
    // the notes of 1.4.0 no longer say that an accountant or a viewer sees no cost
    expect(notes).not.toMatch(/without the stock, purchases or admin permission|ليست له صلاحية المخزن أو المشتريات أو المدير|دەسەڵاتی کۆگا، کڕین یان بەڕێوەبەری نییە/);
    expect(section('en')).toContain('their vouchers page is **My vouchers**, with only the vouchers they prepared.');
    expect(section('ar')).toContain('**من يرى الكلفة والدفاتر، قاعدة واحدة:** من يمسك الدفاتر أو يطّلع عليها يرى الكلفة أيضاً. مدير النظام والمشتريات وأمين المخزن والأدوار المحاسبية (المنظم والمدقق والمصادق) ودور «اطلاع فقط» يرون سعر الشراء ومتوسط الكلفة وقيمة المخزون والربح والدفاتر.');
    expect(section('ar')).toContain('ومن ليس له أي من هذه الأدوار (دور المبيعات وحده، أي الكاشير) لا يرى الكلفة ولا الربح ولا قيمة المخزون ولا الدفاتر: لا القيود ولا دفاتر الشركة ولا المصاريف ولا ما في القاصات والمصارف ولا أعمار ديون المجهزين؛');
    expect(section('ar')).toContain('وصفحة السندات عنده **سنداتي**');
    expect(section('ku')).toContain('**کێ تێچوو و دەفتەرەکان دەبینێت، یەک ڕێسا:** ئەوەی دەفتەرەکان ڕادەگرێت یان دەیانخوێنێتەوە تێچوویش دەبینێت. بەڕێوەبەری سیستەم، کڕین، کۆگادار، ڕۆڵەکانی ژمێریاری (ئامادەکار، وردبین، پەسەندکەر) و «تەنها بینین» نرخی کڕین، تێکڕای تێچوو، بەهای کۆگا، قازانج و دەفتەرەکان دەبینن.');
    expect(section('ku')).toContain('ئەوەی هیچ کام لەم ڕۆڵانەی نییە (تەنها ڕۆڵی فرۆشتن، واتە کاشێر) نە تێچوو دەبینێت، نە قازانج، نە بەهای کۆگا و نە دەفتەرەکان: نە قەیدەکان، نە دەفتەرەکانی کۆمپانیا، نە خەرجییەکان، نە ئەوەی لە قاسە و بانکەکاندایە و نە تەمەنی قەرزی دابینکەران؛');
    expect(section('ku')).toContain('لای ئەو پەڕەی سەنەدەکان ناوی **سەنەدەکانم**ە، و تەنها ئەو سەنەدانەی تێدایە کە خۆی ئامادەی کردوون.');
    // (the earlier wording stacked the same word twice)
    expect(section('ku')).not.toContain('پەڕەی سەنەدەکانی **سەنەدەکانم**ە');
    // the role names are the app's own, in the three languages
    const roles = read('apps/web/src/i18n.ts');
    for (const line of ["role_admin: ['مدير النظام', 'Admin', 'بەڕێوەبەری سیستەم']", "role_preparer: ['المنظم', 'Preparer', 'ئامادەکار']", "role_checker: ['المدقق', 'Checker', 'وردبین']",
      "role_approver: ['المصادق', 'Approver', 'پەسەندکەر']", "role_storekeeper: ['أمين المخزن', 'Storekeeper', 'کۆگادار']", "role_viewer: ['اطلاع فقط', 'Viewer', 'تەنها بینین']"]) expect(roles).toContain(line);
    expect(section('en')).toContain('**Only the buttons you may use:** a menu row, tile or button shows only when the person signed in may do what it does.');
    expect(section('en')).toContain('**The dollar rate at the top of the window,** beside your name.');
    expect(section('ar')).toContain('**سعر الدولار أعلى النافذة،** بجانب اسمك.');
    expect(section('ku')).toContain('**نرخی دۆلار لە سەرەوەی پەنجەرەکە،** لە تەنیشت ناوەکەت.');
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
  });

  it('writes the Kurdish texts with the app\'s accounting words, and says the wording was revised', () => {
    const ku = section('ku');
    for (const word of ['ڕەسید', 'قەرز', 'نەقد', 'قاسە', 'سەنەد', 'پسوولە', 'وەسڵ', 'باکئەپ', 'کۆگا']) expect(ku, word).toContain(word);
    for (const word of ['قەید', 'ڕەسید', 'تەرحیل', 'جەرد', 'نەقد', 'قەرز', 'قاسە', 'وەسڵ']) {
      for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang), `${lang} ${word}`).toContain(word);
    }
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

  it('writes the English notes with one apostrophe, names the Arabic filter as the button it is, and the lists say "Nothing owed" as the notes promise', () => {
    // the typographic apostrophe of the app's own texts and buttons ("Don’t ask again"), never a straight one beside it
    expect(section('en')).not.toMatch(/\w'[\w\s]/);
    expect(section('en')).toContain('**Don’t ask again**');
    // «اعرض المدينون فقط» read as a sentence is wrong grammar: the words are a label, and are named as one
    expect(section('ar')).toContain('فعّل خيار **المدينون فقط**، ورتّب بحسب **الأكبر ديناً أولاً**.');
    expect(section('ar')).not.toContain('اعرض **المدينون فقط**');
    // "We owe them", not "him", in the notes and in the app
    expect(notes).not.toMatch(/We owe him/);
    expect(read('apps/web/src/i18n/shell14.ts')).not.toMatch(/\b(him|his)\b/);
    // the lists write the words beside a name that owes nothing (a dash said nothing)
    expect(read('apps/web/src/pages/Parties.tsx')).toContain("<OweAmount party={p} empty={t('s14_settled')} />");
  });

  it('writes Kurdish with no tatweel', () => {
    expect(section('ku')).not.toContain('ـ');
  });

  it('still tells the holders of 0.1.8 licences to connect once in the first month, in each language', () => {
    expect(section('en')).toMatch(/0\.1\.8[\s\S]*connect this PC to the internet at least once during your first month/);
    expect(section('ar')).toMatch(/0\.1\.8[\s\S]*فاربط هذا الحاسوب بالإنترنت مرة واحدة على الأقل خلال شهرك الأول/);
    // «فصِل» read without its kasra means 'disconnect': never use it for this step
    expect(notes + listing.listings.ar.releaseNotes).not.toMatch(/فصِل|فصل هذا الحاسوب/);
    expect(section('ku')).toMatch(/0\.1\.8[\s\S]*لە مانگی یەکەمت[\s\S]*یەک جار ئەم کۆمپیوتەرە بە ئینتەرنێتەوە ببەستە/);
    // 'it keeps working meanwhile', never 'it works until then'
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
    // the notes of 1.4.0 only: the Store "What's new" is now 1.4.2's, which ships the phone app for Android
    const all = notes;
    expect(all).not.toMatch(/phone app|mobile app|online edition|Google Play|App Store|iPhone|Android/i);
    expect(all).not.toMatch(/تطبيق (الموبايل|الهاتف)|النسخة (السحابية|على الإنترنت)|ئەپی مۆبایل|وەشانی ئۆنلاین/);
  });
});
describe('the release notes of 1.4.1 (kept as shipped)', () => {
  const notes = read('apps/desktop/release-notes/1.4.1.md');
  const section = (lang: 'ar' | 'en' | 'ku') => new RegExp(`^::: ${lang}\\n([\\s\\S]*?)^:::$`, 'm').exec(notes)?.[1] ?? '';

  it('has short notes of 1.4.1 in Arabic, English and Kurdish', () => {
    expect(notes).toMatch(/^\*\*Qasa ERP 1\.4\.1 for Windows\*\*: /);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).trim().length, lang).toBeGreaterThan(1000);
    // the three languages tell of the same things: the same headings and the same number of points under them
    const shape = (lang: 'ar' | 'en' | 'ku') => section(lang).split('\n').filter((l) => /^(### |- )/.test(l)).map((l) => l.slice(0, 2)).join('');
    expect(shape('ar')).toBe(shape('en'));
    expect(shape('ku')).toBe(shape('en'));
  });

  it('upgrades no company file in 1.4.1, so it has no "Before you update" warning', () => {
    // why: 1.4.1 adds no migration; 1.4.0 and 1.4.1 open the same company file (schema 13). Migration 14 (the audit
    // log's sign-in index) came with 1.4.2, whose notes carry the "Before you update" warning
    expect(read('packages/server/src/db.ts')).toContain('{ sql: V13, mysql: { tables: true, steps: () => V13_MYSQL_STEPS } },\n  { sql: V14, ');
    expect(notes).not.toMatch(/Before you update|قبل التحديث|پێش نوێکردنەوە/);
  });

  it('says cheques are for those who keep the books, and that a cashier\'s end of day is their own registers, in the words the app uses', () => {
    const words = read('apps/web/src/i18n/banking.ts') + read('apps/web/src/i18n/day-close.ts') + read('apps/web/src/i18n/brief.ts');
    expect(words).toContain("bk_title: ['البنوك والصكوك', 'Banks & cheques', 'بانک و چەکەکان']");
    expect(words).toContain("dc_title: ['إغلاق اليوم', 'End of day', 'داخستنی ڕۆژ']");
    expect(words).toContain("br_title: ['الموجز اليومي', 'Daily Brief', 'پوختەی ڕۆژانە']");
    expect(section('en')).toContain('no longer sees cheques: not in **Banks & cheques**, not in the **Daily Brief** and not on the home page.');
    expect(section('ar')).toContain('لم يعد يرى الصكوك: لا في **البنوك والصكوك**، ولا في **الموجز اليومي**، ولا في الصفحة الرئيسية.');
    expect(section('ku')).toContain('ئیتر چەکەکان نابینێت: نە لە **بانک و چەکەکان**، نە لە **پوختەی ڕۆژانە** و نە لە پەڕەی سەرەکی.');
    expect(section('en')).toContain('in **End of day**, a user who does not keep the books sees only the registers they opened themselves');
    expect(section('ar')).toContain('في **إغلاق اليوم** يرى المستخدم الذي لا يمسك الدفاتر الصناديق التي فتحها هو فقط');
    expect(section('ku')).toContain('لە **داخستنی ڕۆژ**، بەکارهێنەرێک کە دەفتەرەکان ڕاناگرێت تەنها ئەو کاشێرانە دەبینێت کە خۆی کردوونیەتەوە');
    // the rule the notes tell is the server's (cost-view.ts, day-close.ts)
    expect(read('packages/server/src/cost-view.ts')).toContain("'/api/banking/statements', '/api/banking/cheques'];");
    expect(read('packages/server/src/day-close.ts')).toContain('if (viewer && !seesBooks(viewer)) {');
  });

  it('says receipts from the five documents wait for approval like a quick voucher, with the setting\'s and the chip\'s own words', () => {
    const words = read('apps/web/src/i18n/sales14.ts') + read('apps/web/src/i18n/doc-approval.ts');
    expect(words).toContain("s14_needTitle: ['السندات تحتاج موافقة', 'Vouchers need approval', 'سەنەدەکان پێویستیان بە پەسەندکردنە']");
    expect(words).toContain("da_waiting: ['استُلم، بانتظار الموافقة', 'Collected, waiting for approval', 'وەرگیرا، چاوەڕێی پەسەندکردن']");
    expect(section('en')).toContain('when **Vouchers need approval** is on, a receipt made by a user who may not approve vouchers now also waits when it comes from an installment collected, a job’s deposit, a solar system paid in cash, a unit’s reservation deposit or a generator collection.');
    expect(section('en')).toContain('The page shows it as **Collected, waiting for approval**');
    expect(section('ar')).toContain('حين يكون خيار **السندات تحتاج موافقة** مفعّلاً');
    expect(section('ar')).toContain('تعرضه الصفحة **استُلم، بانتظار الموافقة**');
    expect(section('ku')).toContain('کاتێک **سەنەدەکان پێویستیان بە پەسەندکردنە** چالاکە');
    expect(section('ku')).toContain('پەڕەکە وەک **وەرگیرا، چاوەڕێی پەسەندکردن** پیشانی دەدات');
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang), lang).toMatch(/Approver|المصادق|پەسەندکەر/);
    expect(section('en')).toContain('Users who may approve vouchers, and companies with the setting off, work as before.');
    // the app's own rule (journal.ts)
    expect(read('packages/server/src/journal.ts')).toContain("return vouchersNeedApproval(db) && !approvesOwn(db, { id: null, name: '', mayApprove: actor.permissions.includes('entries.approve') });");
    // under "Separate duties" an approver's own receipt waits too, and the notes say so with the setting's own name
    expect(read('apps/web/src/i18n.ts')).toContain("separateDutiesTitle: ['فصل المهام', 'Separate duties', 'جیاکردنەوەی ئەرکەکان']");
    expect(section('en')).toContain('Under **Separate duties**, an approver’s own receipt waits too, for someone else to approve.');
    expect(section('ar')).toContain('ومع **فصل المهام** ينتظر سند القبض الذي ينظّمه المصادق نفسه أيضاً');
    expect(section('ku')).toContain('لەگەڵ **جیاکردنەوەی ئەرکەکان**، سەنەدی وەرگرتنی خودی پەسەندکەریش چاوەڕێ دەکات');
    expect(section('ku')).toContain('پێشەکیی کار');
    expect(section('ku')).toContain('عەرەبوونی گرتنی یەکە');
  });

  it('names the fixes: counts for one (and two in Arabic), the print design sample, and a page in a browser', () => {
    expect(section('en')).toContain('Counts read right for one in every language ("1 item at or below its minimum", not "1 items"), and Arabic uses the dual for two.');
    expect(section('ar')).toContain('«مادة واحدة عند حدها الأدنى أو تحته»');
    expect(section('ku')).toContain('«1 کاڵا گەیشتووەتە کەمترین بڕی خۆی یان لەوە کەمترە»');
    // the notes quote the app's own words for one item
    expect(read('apps/web/src/i18n/counts.ts')).toContain("ro_count__one: ['مادة واحدة عند حدها الأدنى أو تحته', '{n} item at or below its minimum', '{n} کاڵا گەیشتووەتە کەمترین بڕی خۆی یان لەوە کەمترە']");
    expect(read('apps/web/src/i18n/labels.ts')).toContain("pd_title: ['تصميم الطباعة', 'Print design', 'دیزاینی چاپ']");
    for (const [lang, name] of [['en', '**Print design**'], ['ar', '**تصميم الطباعة**'], ['ku', '**دیزاینی چاپ**']] as const) expect(section(lang), lang).toContain(name);
    expect(notes).not.toMatch(/Toyota|تويوتا|تۆیۆتا/);
  });

  it('names what the hands-on test of 1.4.0 found in printing, in the words of Settings → Printers', () => {
    const words = read('apps/web/src/i18n/printers.ts');
    expect(words).toContain("prn_title: ['الطابعات', 'Printers', 'چاپکەرەکان']");
    expect(words).toContain("prn_silent: ['الطباعة دون سؤال', 'Print without asking', 'چاپ بێ پرسیار']");
    expect(words).toContain("prn_testTitle: ['صفحة تجربة الطابعة', 'Printer test page', 'پەڕەی تاقیکردنەوەی چاپکەر']");
    expect(section('en')).toContain('no longer puts a dark or grey frame in the page margins');
    expect(section('en')).toContain('no longer start with a blank page');
    expect(section('en')).toContain('**Print without asking** is not offered for such a printer');
    expect(section('ar')).toContain('**الطباعة دون سؤال**');
    expect(section('ar')).toContain('**صفحة تجربة الطابعة**');
    expect(section('ku')).toContain('**چاپ بێ پرسیار**');
    expect(section('ku')).toContain('**پەڕەی تاقیکردنەوەی چاپکەر**');
    // the fixes the notes tell are in the app (printing.ts, main.ts, pos.css, styles.css)
    expect(read('apps/desktop/src/main.ts')).toContain("const PRINT_BACKGROUND = '#FFFFFF';");
    expect(read('apps/web/src/pos.css')).toContain('body.pos-printing > #root { display: none !important; }');
  });

  it('writes Kurdish with the app\'s words and no tatweel, and English with one apostrophe', () => {
    const ku = section('ku');
    expect(ku).not.toContain('ـ');
    expect(ku).not.toMatch(/[ىيك]/);
    for (const word of ['قیست', 'سەنەد', 'پەسەندکردن']) expect(ku, word).toContain(word);
    // the typographic apostrophe of the app's own texts ("Don’t ask again"), never a straight one beside it
    expect(section('en')).not.toMatch(/\w'[\w\s]/);
  });

  it('still tells the holders of 0.1.8 licences to connect once in the first month, in each language', () => {
    expect(section('en')).toMatch(/0\.1\.8[\s\S]*connect this PC to the internet at least once during your first month/);
    expect(section('ar')).toMatch(/0\.1\.8[\s\S]*فاربط هذا الحاسوب بالإنترنت مرة واحدة على الأقل خلال شهرك الأول/);
    expect(section('ku')).toMatch(/0\.1\.8[\s\S]*لە مانگی یەکەمت[\s\S]*یەک جار ئەم کۆمپیوتەرە بە ئینتەرنێتەوە ببەستە/);
    expect(notes).not.toMatch(/فصِل|فصل هذا الحاسوب/);
  });

  it('never says Starter comes with Qasa Relay or the cloud backup, nor offers the phone app or the online edition', () => {
    expect(notes).not.toMatch(/Starter[^.\n]*(Relay|cloud backup)/);
    expect(notes).not.toMatch(/phone app|mobile app|online edition|Google Play|App Store|iPhone|Android/i);
    expect(notes).not.toMatch(/تطبيق (الموبايل|الهاتف)|النسخة (السحابية|على الإنترنت)|ئەپی مۆبایل|وەشانی ئۆنلاین/);
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

  it('is 1.4.2, the same in the app, the core and the lock file, with a notes file that has Arabic, English and Kurdish', () => {
    expect(version).toBe('1.4.2');
    expect(read('packages/core/src/version.ts')).toContain(`APP_VERSION = '${version}'`);
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string }> };
    expect(lock.packages['apps/desktop']?.version).toBe(version);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(notes, lang).toMatch(new RegExp(`^::: ${lang}\\n[\\s\\S]+?^:::$`, 'm'));
  });

  it('has notes of 1.4.2 in Arabic, English and Kurdish (the Store "What\'s new" is now the draft of the next submission)', () => {
    expect(notes).toMatch(/^\*\*Qasa ERP 1\.4\.2 for Windows\*\*: /);
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).trim().length, lang).toBeGreaterThan(3000);
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
      expect(store[lang].description.length).toBeLessThanOrEqual(10_000);
    }
  });

  it('says first that 1.4.1 cannot open a company file 1.4.2 has upgraded: every PC is updated, and an older Store copy waits for 1.4.2', () => {
    // why: 1.4.2 adds migration 14 (the audit log's index for the sign-in check), the last one, and an app refuses a newer file
    const db = read('packages/server/src/db.ts');
    expect(db).toContain('{ sql: V14, mysql: { tables: true, steps: () => V14_MYSQL_STEPS } }\n];');
    expect(db).toContain("if (version > app) throw new AppError(409, 'database_newer', { version, app });");
    expect(section('en')).toContain('### Before you update\n- **The company file is upgraded to a new version.** A copy of it is kept beside it before the update. Qasa ERP 1.4.1 and earlier cannot open a file that 1.4.2 has upgraded, so update every PC that opens the same company. A Microsoft Store copy that is still on an older version cannot open it until the Store has 1.4.2.');
    expect(section('ar')).toContain('### قبل التحديث\n- **يُرقّى ملف الشركة إلى إصدار جديد.** تُحفظ نسخة منه بجانبه قبل التحديث. لا يفتح قاصة ERP 1.4.1 وما قبله ملفاً رقّاه الإصدار 1.4.2، فحدّث كل حاسوب يفتح الشركة نفسها. ونسخة متجر Microsoft التي ما زالت على إصدار أقدم لا تفتحه حتى يصل الإصدار 1.4.2 إلى المتجر.');
    expect(section('ku')).toContain('### پێش نوێکردنەوە\n- **فایلی کۆمپانیا بەرز دەکرێتەوە بۆ وەشانێکی نوێ.** پێش نوێکردنەوە کۆپییەکی لە تەنیشتی دەپارێزرێت. قاسە ERP 1.4.1 و وەشانەکانی پێشتر فایلێک ناکەنەوە کە 1.4.2 بەرزی کردبێتەوە');
    // before everything else, in each language
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang).indexOf('1.4.1'), lang).toBeLessThan(section(lang).indexOf('0.1.8'));
  });

  it('tells of amounts in dinar and dollar where the app has the choice, for admins, in the words of Settings', () => {
    const words = read('apps/web/src/i18n/amounts.ts') + read('apps/web/src/i18n.ts');
    expect(words).toContain("displayTitle: ['اللغة والعرض', 'Language and display', 'زمان و پیشاندان']");
    expect(words).toContain("am_show: ['عرض المبالغ', 'Show amounts in', 'پیشاندانی بڕی پارە']");
    expect(words).toContain("am_iqd: ['الدينار فقط', 'Dinar only', 'تەنها دینار']");
    expect(words).toContain("am_iqdUsd: ['الدينار والدولار', 'Dinar and dollar', 'دینار و دۆلار']");
    expect(words).toContain("am_usdIqd: ['الدولار والدينار', 'Dollar and dinar', 'دۆلار و دینار']");
    expect(section('en')).toContain('in **Settings → Language and display → Show amounts in**, an admin chooses **Dinar only** (as before), **Dinar and dollar** or **Dollar and dinar**');
    expect(section('ar')).toContain('في **الإعدادات ← اللغة والعرض ← عرض المبالغ** يختار المدير **الدينار فقط** (كما كان) أو **الدينار والدولار** أو **الدولار والدينار**');
    expect(section('ku')).toContain('لە **ڕێکخستنەکان ← زمان و پیشاندان ← پیشاندانی بڕی پارە**، بەڕێوەبەر **تەنها دینار** (وەک پێشوو)، **دینار و دۆلار** یان **دۆلار و دینار** هەڵدەبژێرێت');
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang), lang).toContain('≈');
    // the choice is the company's, kept and checked by the server, and offered to admins only
    expect(read('packages/server/src/settings.ts')).toContain("writeSetting(db, 'amounts_show', patch.amountsShow)");
    expect(read('apps/web/src/pages/Settings.tsx')).toContain('{admin && <AmountsShowSetting />}');
    expect(store['en-us'].features).toContain('Iraqi dinars and US dollars, with the day\'s rate; totals can also show their value in the other currency');
  });

  it('tells of adding a missing item on the spot and correcting an item\'s stock, with the words the buttons carry', () => {
    const words = read('apps/web/src/i18n/item-quick.ts') + read('apps/web/src/i18n.ts');
    expect(words).toContain("iq_addNamed: ['إضافة «{name}» مادةً جديدة', 'Add “{name}” as a new item', '«{name}» وەک کاڵای نوێ زیاد بکە']");
    expect(words).toContain("iq_stockNow: ['الموجود الآن (اختياري)', 'In stock now (optional)', 'ئێستا لە کۆگادا (ئارەزوومەندانە)']");
    expect(words).toContain("sc_title: ['تصحيح المخزون', 'Correct stock', 'ڕاستکردنەوەی کۆگا']");
    expect(words).toContain("items: ['المواد والمخزون', 'Items & stock', 'کاڵا و کۆگا']");
    expect(section('en')).toContain('**Add “…” as a new item** opens a short form');
    expect(section('ar')).toContain('**إضافة «…» مادةً جديدة**');
    expect(section('ku')).toContain('**«…» وەک کاڵای نوێ زیاد بکە**');
    expect(section('en')).toContain('in **Items & stock**, the **Correct stock** button');
    expect(section('ar')).toContain('في **المواد والمخزون** زر **تصحيح المخزون**');
    expect(section('ku')).toContain('لە **کاڵا و کۆگا**، دوگمەی **ڕاستکردنەوەی کۆگا**');
    // each reason the notes name is one the form offers, in its own words
    const reasons: readonly (readonly [string, string, string, string])[] = [
      ['purchase_missing', 'Purchase not entered', 'شراء لم يُدخَل', 'کڕینێک کە نەنووسراوە'],
      ['found', 'Found in a count', 'وُجد في الجرد', 'لە جەرددا دۆزرایەوە'],
      ['damaged', 'Damaged', 'تالف', 'تەلەف'],
      ['lost', 'Lost', 'مفقود', 'ونبوو'],
      ['opening', 'Opening stock', 'رصيد أول المدة', 'کاڵای سەرەتا'],
      ['other', 'Other', 'أخرى', 'هی تر']
    ];
    expect(read('packages/server/src/stock-correction.ts')).toContain(`CORRECTION_REASONS = [${reasons.map(([r]) => `'${r}'`).join(', ')}] as const;`);
    for (const [reason, en, ar, ku] of reasons) {
      expect(words, reason).toContain(`sc_r_${reason}: ['${ar}', '${en}', '${ku}']`);
      expect(section('en'), reason).toContain(`**${en}**`);
      expect(section('ar'), reason).toContain(`**${ar}**`);
      expect(section('ku'), reason).toContain(`**${ku}**`);
    }
    // where the notes say: the item box of invoices, quotations, purchase orders and the till; the row and the item's page
    for (const page of ['Invoices', 'Quotes', 'PurchaseOrders']) expect(read(`apps/web/src/pages/${page}.tsx`), page).toContain('<ItemPicker ');
    expect(read('apps/web/src/pages/Pos.tsx')).toContain('<QuickItemForm ');
    expect(read('apps/web/src/pages/Items.tsx').match(/can\('adjustment'\) && it\.trackStock && it\.active/g)).toHaveLength(2);
  });

  it('offers the phone app for Android in the words given for it, on Starter, Pro and Business, and Starter on the office Wi-Fi only', () => {
    expect(section('en')).toContain('- **The Qasa phone app for Android:** Settings → Office network → Phones (Qasa app) now offers the app (download it from qasaerp.com/phone, with its SHA-256 and signing fingerprint to check) and pairs phones. Starter, Pro and Business; Starter on the office Wi-Fi only.');
    expect(section('ar')).toContain('- **تطبيق قاصة للهاتف على أندرويد:** صار في الإعدادات ← شبكة المكتب ← الهواتف (تطبيق قاصة) رابط تنزيل التطبيق من qasaerp.com/phone مع بصمتيه للتحقق، وربط الهواتف. في Starter وPro وBusiness، وStarter على Wi-Fi المكتب فقط.');
    expect(section('ku')).toContain('- **ئەپی قاسە بۆ مۆبایلی ئەندرۆید:** لە ڕێکخستنەکان ← تۆڕی نووسینگە ← مۆبایلەکان (ئەپی قاسە) ئێستا ئەپەکە لە qasaerp.com/phone دادەگیرێت، لەگەڵ پەنجەمۆرەکانی بۆ پشکنین، و مۆبایل دەبەسترێتەوە. Starter، Pro و Business؛ Starter تەنها لەسەر Wi-Fi ی نووسینگە.');
    // the phones card is in the Office network section (there is no Phones section), named as the app names them; the
    // What's new of a PC that skips 1.4.2 shows these notes too
    expect(notes).not.toMatch(/Settings → Phones|الإعدادات ← الهواتف|ڕێکخستنەکان ← مۆبایلەکان/);
    // the app offers it: the download page, its checks, and the plans (Starter has the phone app but not Qasa Relay)
    const settings = read('apps/web/src/pages/Settings.tsx');
    expect(settings).toContain('export const PHONE_APP_READY = true;');
    expect(settings).toContain("url: 'https://qasaerp.com/phone/',");
    expect(settings).toMatch(/apkSha256: '[0-9a-f]{64}'/);
    expect(settings).toMatch(/certSha256: '[0-9a-f]{64}'/);
    const starter = /STARTER_FEATURES: readonly Feature\[\] = \[([^\]]*)\]/.exec(read('packages/core/src/plans.ts'))?.[1] ?? '';
    expect(starter).toContain("'phoneApp'");
    expect(starter).not.toContain("'relay'");
    expect(store['en-us'].description).toContain('• The Qasa phone app for Android (Starter, Pro and Business): download it from qasaerp.com/phone');
    // Android by direct download: no Google Play, App Store or iPhone yet
    expect([notes, ...Object.values(store).flatMap((l) => [l.releaseNotes, l.description, ...l.features])].join('\n')).not.toMatch(/Google Play|App Store|iPhone|iOS/);
  });

  it('tells of the safer Qasa Relay in plain words, as the sign-in check and Settings → Office network do it', () => {
    // relay sign-ins count apart from the office's own, and places known before apart from new ones (auth.ts)
    const auth = read('packages/server/src/auth.ts');
    expect(auth).toContain("const accountKey = relay ? `${account}|relay-${known ? 'known' : 'new'}` : account;");
    expect(auth).toContain("audit(db, row.name, 'login', 'user', row.id, { source: place });");
    expect(read('apps/web/src/i18n/relay.ts')).toContain("netNewCert: ['شهادة مكتب جديدة', 'New office certificate', 'بڕوانامەی نوێی نووسینگە']");
    expect(read('apps/web/src/i18n.ts')).toContain("netTitle: ['شبكة المكتب', 'Office network', 'تۆڕی نووسینگە']");
    // the places known come from sign-ins audited with their source, which only 1.4.2 writes: "since this update"
    expect(section('en')).toContain('no longer makes that user wait on the office’s own PCs, nor at the places where they have signed in through the relay since this update (a home or a branch): only new places wait.');
    expect(section('ar')).toContain('ولا في الأماكن التي دخل منها عبر Qasa Relay منذ هذا التحديث (البيت أو الفرع)');
    expect(section('ku')).toContain('نە لەو شوێنانەی لەم نوێکردنەوەیەوە لە ڕێی Relay ەوە لێیانەوە چووەتە ژوورەوە');
    for (const text of [notes, ...Object.values(store).map((l) => l.releaseNotes)]) expect(text).not.toMatch(/signed in (through the relay )?before|دخل منها عبر Qasa Relay من قبل|حيث دخل من قبل/);
    // staff keep their place only with the 1.4.2 relay: it is deployed before the release
    const releasing = read('docs/releasing.md');
    expect(releasing).toContain('## Release day for 1.4.2');
    expect(releasing).toContain('1. **Deploy the 1.4.2 Qasa Relay first**');
    // a website on the office network pins the certificate: a new one needs its new code there
    expect(section('en')).toContain('A website that connects on the office network needs the new certificate code from **Settings → Website API** (through Qasa Relay nothing changes).');
    expect(section('ar')).toContain('يحتاج رمز الشهادة الجديد من **الإعدادات ← ربط المواقع الإلكترونية**');
    expect(section('ku')).toContain('پێویستی بە کۆدە نوێیەکەی بڕوانامە هەیە لە **ڕێکخستنەکان ← بەستنەوەی ماڵپەڕ**');
    expect(read('apps/web/src/i18n/webapi.ts')).toContain("wa_nav: ['ربط المواقع الإلكترونية', 'Website API', 'بەستنەوەی ماڵپەڕ']");
    // the WooCommerce plugin that takes only the 32-character code or the full fingerprint is 1.1.2, as the notes say
    // (pro/ is the private Pro module, present only in Meroxis' checkout and the release build; the public CI has no plugin)
    const plugin = 'pro/integrations/woocommerce/qasa-erp/qasa-erp.php';
    if (existsSync(join(root, plugin))) expect(read(plugin)).toContain("define('QASA_ERP_VERSION', '1.1.2');");
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang), lang).toMatch(/WooCommerce[^\n]{0,10}1\.1\.2:\*\*/);
    expect(section('en')).toContain('**Settings → Office network → New office certificate**');
    expect(section('ar')).toContain('**الإعدادات ← شبكة المكتب ← شهادة مكتب جديدة**');
    expect(section('ku')).toContain('**ڕێکخستنەکان ← تۆڕی نووسینگە ← بڕوانامەی نوێی نووسینگە**');
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang), lang).toContain('PIN');
    // the phone's PIN that can't be turned off is the phone app's own rule (roles.ts), in the build Settings offers (1.0.1)
    expect(read('apps/mobile/src/roles.ts')).toContain('export function lockRequired(me: Me | null): boolean {');
    const mobile = JSON.parse(read('apps/mobile/app.json')) as { expo: { version: string; android: { versionCode: number } } };
    expect(mobile.expo.version).toBe('1.0.1');
    expect(mobile.expo.android.versionCode).toBe(2);
    expect(read('apps/web/src/pages/Settings.tsx')).toContain("version: '1.0.1',");
    for (const lang of ['ar', 'en', 'ku'] as const) expect(section(lang), lang).toContain('1.0.1');
    // plain words: no frames, sockets, tokens or rate limits in the notes
    expect(notes).not.toMatch(/WebSocket|socket|token|frame|rate limit|IPv6|\/48/i);
  });

  it('writes Kurdish with the app\'s words and no tatweel, and English with one apostrophe', () => {
    const ku = section('ku') + store['ku-arab'].releaseNotes;
    expect(ku).not.toContain('ـ');
    expect(ku).not.toMatch(/[ىيك]/);
    for (const word of ['کاڵا', 'کۆگا', 'تەرحیل', 'دابینکەر']) expect(ku, word).toContain(word);
    expect(section('en') + store['en-us'].releaseNotes).not.toMatch(/\w'[\w\s]/);
  });

  it('still tells the holders of 0.1.8 licences to connect once in the first month, in each language', () => {
    expect(section('en')).toMatch(/0\.1\.8[\s\S]*connect this PC to the internet at least once during your first month/);
    expect(section('ar')).toMatch(/0\.1\.8[\s\S]*فاربط هذا الحاسوب بالإنترنت مرة واحدة على الأقل خلال شهرك الأول/);
    expect(section('ku')).toMatch(/0\.1\.8[\s\S]*لە مانگی یەکەمت[\s\S]*یەک جار ئەم کۆمپیوتەرە بە ئینتەرنێتەوە ببەستە/);
    expect(notes + store.ar.releaseNotes).not.toMatch(/فصِل|فصل هذا الحاسوب/);
  });

  it('never says Starter comes with Qasa Relay or the cloud backup, nor offers the online edition', () => {
    const all = [notes, ...Object.values(store).map((l) => l.releaseNotes)].join('\n');
    expect(all).not.toMatch(/Starter[^.\n]*(Relay|cloud backup)/);
    expect(all).not.toMatch(/Starter[^.\n]*(Qasa Relay|النسخ إلى السحابة|باکئەپ بۆ هەور)/);
    expect(all).not.toMatch(/online edition|النسخة (السحابية|على الإنترنت)|وەشانی ئۆنلاین/i);
  });
});

// The draft for the next Store submission: its first line names the version, a {{1.4.3}} line keeps the place of its
// own items until the release writes them (docs/releasing.md), and its last line tells of 1.4.1, which Store copies
// were never told of. Replace this block with the next version's when 1.4.3 is released.
describe('the Store "What\'s new" of the next submission (1.4.3)', () => {
  const store = (JSON.parse(read('apps/desktop/store-listing.json')) as {
    listings: Record<'en-us' | 'ar' | 'ku-arab', { releaseNotes: string }>;
  }).listings;
  const LANGS = ['en-us', 'ar', 'ku-arab'] as const;
  const lines = (lang: (typeof LANGS)[number]) => store[lang].releaseNotes.split('\n');

  it('names 1.4.3 first, in each language, with a place for its own items', () => {
    expect(lines('en-us')[0]).toBe('Qasa ERP 1.4.3.');
    expect(lines('ar')[0]).toBe('قاصة ERP 1.4.3.');
    expect(lines('ku-arab')[0]).toBe('قاسە ERP 1.4.3.');
    for (const lang of LANGS) {
      // the only placeholder there may be is the one for the items of 1.4.3
      for (const placeholder of store[lang].releaseNotes.match(/\{\{[^}]*\}\}/g) ?? []) expect(placeholder, lang).toBe('{{1.4.3}}');
      expect(store[lang].releaseNotes.length, lang).toBeLessThanOrEqual(1500);
    }
  });

  it('tells Store copies, in the same words in each language, what 1.4.1 brought: the Store went from 1.4.0 straight to 1.4.2', () => {
    expect(lines('en-us').at(-1)).toBe('Also from 1.4.1, which came to the Store with 1.4.2: a sales-only user no longer sees cheques, and sees only their own registers and shifts in End of day; with Vouchers need approval on, receipts from installments, deposits and collections wait for approval too; and printing fixes.');
    expect(lines('ar').at(-1)).toBe('ومن الإصدار 1.4.1، الذي وصل إلى المتجر مع 1.4.2: من له دور المبيعات وحده لم يعد يرى الصكوك، ولا يرى في إغلاق اليوم إلا صناديقه ووردياته؛ وحين يكون خيار «السندات تحتاج موافقة» مفعّلاً تنتظر الموافقة أيضاً سندات القبض من الأقساط والعربون والجباية؛ وإصلاحات في الطباعة.');
    expect(lines('ku-arab').at(-1)).toBe('هەروەها لە وەشانی 1.4.1 ەوە، کە لەگەڵ 1.4.2 گەیشتە Store: ئەوەی تەنها ڕۆڵی فرۆشتنی هەیە ئیتر چەکەکان نابینێت، و لە داخستنی ڕۆژ تەنها کاشێر و شەفتەکانی خۆی دەبینێت؛ کاتێک «سەنەدەکان پێویستیان بە پەسەندکردنە» چالاکە، سەنەدی وەرگرتن لە قیست، پێشەکی و کۆکردنەوە چاوەڕێی پەسەندکردن دەکات؛ و چاککردنەوەی چاپ.');
    // in the words the 1.4.1 notes and the app use
    const notes = read('apps/desktop/release-notes/1.4.1.md');
    for (const words of ['**Vouchers need approval**', '**السندات تحتاج موافقة**', '**سەنەدەکان پێویستیان بە پەسەندکردنە**', '**End of day**', '**إغلاق اليوم**', '**داخستنی ڕۆژ**']) {
      expect(notes, words).toContain(words);
    }
  });

  it('leaves out the line for the holders of 0.1.8 licences, which was for the first month on 1.0', () => {
    for (const lang of LANGS) expect(store[lang].releaseNotes, lang).not.toContain('0.1.8');
  });

  it('writes Kurdish with Kurdish letters and no tatweel, and English with one apostrophe', () => {
    expect(store['ku-arab'].releaseNotes).not.toMatch(/[ىيكـ]/);
    expect(store['en-us'].releaseNotes).not.toMatch(/\w'[\w\s]/);
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
