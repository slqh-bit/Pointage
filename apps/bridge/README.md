# apps/bridge — pont .NET 4.8 (gabarits biométriques uniquement)

Service Windows .NET Framework 4.8 hébergeant le SDK constructeur pour
**un seul travail** : lire et écrire les gabarits visage/empreinte sur les
firmwares où le SDK officiel est le seul chemin supporté (Plan §06, mode C).

**Il n'est pas sur le chemin du pointage.** La collecte passe par ADMS push
(mode A) et le pull zklib-js (mode B), tous deux en Node.

**Construit uniquement si le spike P0 le montre nécessaire.** Si les gabarits
sont accessibles via le protocole ouvert, ce dossier reste vide et .NET 4.8
demeure simplement le prérequis d'environnement listé par le CCTP — que nous
installons de toute façon.

Contrat d'interface consommé par `@pointage/drivers` (`templateBridgeUrl`) :

```
GET /templates/{userId}?kind=FACE_TEMPLATE|FINGERPRINT_TEMPLATE  → octet-stream
PUT /templates/{userId}                                          ← octet-stream
```
