# Pointage — CHU La Rabta

Système de pointage biométrique — Consultation INF01/2026, lot unique.
Ce dépôt exécute le **Plan de développement, Révision 2**
(`Plan_Developpement_Logiciel_Pointage_CHU_Rabta.pdf`, à la racine).

- 25 blocs · 25 terminaux · 35+ services · 3 000+ agents
- Délai contractuel : 60 jours · Effort estimé : ~130 j·dev
- Option retenue (§02) : **D — le domaine nous appartient, le reste est assemblé**
  depuis des composants open source à licences permissives uniquement.

## Architecture (§05)

```
① EDGE     25 pointeuses (visage · empreinte · badge) · mobile GPS · poste web
② COLLECTE ADMS push (primaire) · pull zklib-js (réconciliation) · pont .NET 4.8 (gabarits)
③ CŒUR     Moteur de règles · Planning · Absences · RBAC + audit · API REST + webhooks
④ DONNÉES  MySQL 8 · punches · day_results · audit
⑤ CLIENTS  Portail web FR / AR (RTL) / EN
```

## Structure (§10)

| Chemin | Contenu |
|---|---|
| `apps/api` | Fastify + Prisma — services cœur, moteur de règles (`src/engine`) |
| `apps/web` | Portail React + Vite + Tailwind (aucune installation poste client) |
| `apps/mobile` | Module mobile Expo — shell créé en P6 (T1 : pointage géolocalisé) |
| `apps/bridge` | Pont .NET 4.8 — gabarits biométriques, seulement si le spike P0 l'exige |
| `packages/contracts` | Schémas zod + types TS partagés API / web / mobile |
| `packages/drivers` | Contrat `DeviceDriver` + adaptateurs ZKTeco / Suprema / Hikvision |
| `packages/i18n` | Bundles FR · AR (RTL) · EN |
| `ops` | IIS/ARR, sauvegarde MySQL, NSSM, SBOM |
| `docs` | Livrables CCTP (exploitation, pannes, messages d'erreur) |

## Démarrage

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # éditer DATABASE_URL
pnpm db:migrate                          # crée le schéma MySQL 8
pnpm db:seed                             # rôles, gabarits de poste, cycle 3×8, admin
pnpm dev:api                             # API sur :8080
pnpm dev:web                             # portail sur :5173
```

Tests du moteur de règles (les 8 cas contractuels du §08) :

```bash
pnpm --filter @pointage/api test
```

SBOM + contrôle de licences (règle §04 : permissives uniquement) :

```bash
pnpm sbom
```

## Invariants structurants

- **`punch` est append-only** — jamais muté ; toute correction est une ligne
  `punch_correction` liée, avec auteur (§06 DESIGN RULE).
- **Idempotence ADMS** sur `(device, deviceUserId, punchedAt)` — un retry
  terminal ne crée jamais de doublon.
- **`day_result`** : une ligne par agent par jour, recalcul incrémental,
  reconstruisable depuis le brut (§07).
- **Période clôturée** : recalcul refusé sans déverrouillage explicite tracé
  en audit (§08).
- **Audit par middleware Prisma** — aucune route ne peut l'oublier (§07).
- **Multi-marques structurel** : une nouvelle marque = un nouvel adaptateur
  `DeviceDriver`, pas un fork (§01/§06).
- **Licences permissives uniquement** — le SBOM CI échoue sur tout copyleft (§04).

## Phases (§11)

P0 dé-risquage → P1 fondation (J0–J10) → P2 terminaux (J8–J20) →
P3 moteur & planning (J15–J30) → P4 absences (J25–J38) →
P5 rapports (J30–J42) → P6 mobile (J35–J45) →
P7 intégration & durcissement (J40–J50) → P8 déploiement, UAT, formation (J48–J58).

État d'avancement : voir `docs/README.md` et les issues du dépôt.
