// Usage: npm run eval
import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluate, type Metrics, type Sample } from "../src/evaluate";
import { scanText } from "../src/scanner";

const samples: Sample[] = JSON.parse(readFileSync(path.join(__dirname, "samples.json"), "utf8"));
const report = evaluate(samples, scanText);

const pct = (x: number | null) => (x === null ? "  n/a" : `${(x * 100).toFixed(0).padStart(4)}%`);
const row = (label: string, m: Pick<Metrics, "tp" | "fp"> & Partial<Metrics>) =>
  `${label.padEnd(14)} tp=${String(m.tp).padStart(2)} fp=${String(m.fp).padStart(2)} fn=${
    m.fn === undefined ? " -" : String(m.fn).padStart(2)
  }  precision ${pct(m.precision ?? null)}  recall ${m.recall === undefined ? "    -" : pct(m.recall)}`;

console.log(`${samples.length} samples\n`);
console.log(row("OVERALL", report.overall));
console.log("\nBy type");
for (const [type, m] of Object.entries(report.byType)) console.log("  " + row(type, m));
console.log("\nBy rule confidence (why the review step exists)");
for (const [tier, m] of Object.entries(report.byConfidence)) console.log("  " + row(tier, m));

if (report.misses.length) {
  console.log("\nMissed (false negatives)");
  for (const m of report.misses) console.log(`  [${m.sample}] ${m.type}: ${m.text}`);
}
if (report.falsePositives.length) {
  console.log("\nWrongly flagged (false positives)");
  for (const f of report.falsePositives) console.log(`  [${f.sample}] ${f.type} (${f.confidence}): ${f.text}`);
}
