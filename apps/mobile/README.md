# apps/mobile — module mobile (Expo)

**Périmètre T1 (Plan §12)** : pointage mobile avec géolocalisation et
géorepérage — suffisant pour démontrer la conformité à la recette.

**Périmètre T2 (garantie 12 mois)** : application complète — planning,
soldes, file hors-ligne SQLite, liaison d'appareil par agent, détection de
fausse localisation.

Le backend du pointage mobile est déjà en place :
`POST /api/v1/punches` (source `MOBILE`, lat/lng, verdict `geofenceOk`
calculé contre le site de l'agent — voir `apps/api/src/modules/attendance`).

Le shell Expo est créé en P6 (J35–J45). Non initialisé volontairement :
inutile de porter ses dépendances avant la phase qui le construit.
