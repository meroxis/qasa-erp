import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

// 2.0.0 (the product review): nothing of wholesale, delivery or consignment could be printed
it('prints the wholesale papers, the delivery slip and the consignment statement alone', () => {
  const ws = src('./pages/Wholesale.tsx');
  for (const tag of ['<PrintPart id="ws-route">', '<PrintPart id={`ws-order-${o.id}`}>', '<PrintPart id="ws-van">', '<PrintPart id={`ws-col-${c.id}`}>']) expect(ws, tag).toContain(tag);
  expect(src('./pages/Delivery.tsx')).toContain('<PrintPart id={`dl-${o.id}`}>');
  const cg = src('./pages/Consignment.tsx');
  expect(cg).toContain('<PrintPart id="cg-statement">');
  expect(cg).toContain('shareStatement(i18n, company, { name: data.supplierName');
  const part = src('./industry/PrintPart.tsx');
  expect(part).toContain("void printAlone('report', 'print-part');");
  expect(src('./styles.css')).toContain('body.print-part .print-part-host.print-part-on { display: block; }');
});
