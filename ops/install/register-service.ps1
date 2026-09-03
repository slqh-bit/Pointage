# Enregistrement du service Windows via NSSM — Plan §01/§03.
# L'API Node tourne en Windows Service : certificats, journaux et politique
# de redémarrage restent dans l'outillage que l'unité informatique connaît.
# À exécuter en administrateur sur le serveur du CHU.

param(
  [string]$ServiceName = "PointageRabtaAPI",
  [string]$AppDir = "C:\pointage-rabta\apps\api",
  [string]$NodeExe = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Stop"

nssm install $ServiceName $NodeExe "$AppDir\dist\server.js"
nssm set $ServiceName AppDirectory $AppDir
nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production"
nssm set $ServiceName AppStdout "C:\pointage-rabta\logs\api-out.log"
nssm set $ServiceName AppStderr "C:\pointage-rabta\logs\api-err.log"
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateBytes 10485760
nssm set $ServiceName Start SERVICE_AUTO_START
nssm set $ServiceName Description "API pointage biométrique CHU La Rabta (INF01/2026)"

# Instance de staging : même serveur, base et port séparés (exigence CCTP).
nssm install "${ServiceName}Staging" $NodeExe "$AppDir\dist\server.js"
nssm set "${ServiceName}Staging" AppDirectory $AppDir
nssm set "${ServiceName}Staging" AppEnvironmentExtra "NODE_ENV=staging" "PORT=8081" "DATABASE_URL=mysql://pointage:***@localhost:3306/pointage_rabta_staging"
nssm set "${ServiceName}Staging" Start SERVICE_AUTO_START

Write-Output "Services enregistrés : $ServiceName, ${ServiceName}Staging"
