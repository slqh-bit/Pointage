#!/usr/bin/env node
/**
 * Génération du SBOM — Plan §04.
 *
 * Chaque composant livré avec sa version et sa licence ; le rapport est un
 * artefact des « rapports de conformité » exigés par le CCTP. La règle du
 * plan : uniquement des licences permissives (MIT, Apache-2.0, BSD, ISC) —
 * tout composant copyleft fait échouer le build.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PERMISSIVE = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "CC0-1.0", "Python-2.0", "BlueOak-1.0.0"]);
const FORBIDDEN_PATTERN = /GPL|AGPL|LGPL|SSPL|EUPL|CDDL|MPL/i;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "ops", "sbom", "out");
mkdirSync(outDir, { recursive: true });

const raw = execSync("pnpm licenses list --json --long", { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString();
const byLicense = JSON.parse(raw);

const rows = [];
const violations = [];
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    for (const version of pkg.versions ?? []) {
      rows.push({ name: pkg.name, version, license });
      const isPermissive = [...PERMISSIVE].some((l) => license.includes(l));
      if (!isPermissive || FORBIDDEN_PATTERN.test(license)) {
        violations.push({ name: pkg.name, version, license });
      }
    }
  }
}

rows.sort((a, b) => a.name.localeCompare(b.name));
const sbom = {
  generatedAt: new Date().toISOString(),
  project: "pointage-rabta — CHU La Rabta (INF01/2026)",
  rule: "Licences permissives uniquement (Plan §04) : MIT, Apache-2.0, BSD, ISC. Aucun composant GPL/AGPL/LGPL.",
  components: rows,
  violations,
};
writeFileSync(join(outDir, "sbom.json"), JSON.stringify(sbom, null, 2));

if (violations.length > 0) {
  console.error("ÉCHEC — composants non conformes à la règle de licence (Plan §04) :");
  for (const v of violations) console.error(`  ${v.name}@${v.version} — ${v.license}`);
  process.exit(1);
}
console.log(`SBOM généré : ${rows.length} composants, toutes licences permissives.`);
