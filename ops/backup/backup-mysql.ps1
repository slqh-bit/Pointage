# Sauvegarde MySQL quotidienne — Plan §03/§11 (P7).
# Enregistrée dans le Planificateur de tâches du serveur du CHU.
# Rétention : 30 jours glissants. La restauration est répétée et chronométrée
# sur l'instance de staging avant la réception (EXIT P7).

param(
  [string]$DbName = "pointage_rabta",
  [string]$DbUser = "pointage",
  [string]$OutDir = "D:\backups\pointage",
  [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dumpFile = Join-Path $OutDir "$DbName-$timestamp.sql"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Le mot de passe est lu depuis un fichier d'option protégé (ops\install\my.cnf),
# jamais en ligne de commande (visible dans la liste des processus).
& mysqldump --defaults-extra-file="$PSScriptRoot\my.cnf" --single-transaction --routines --triggers $DbName > $dumpFile
if ($LASTEXITCODE -ne 0) { throw "mysqldump a échoué ($LASTEXITCODE)" }

Compress-Archive -Path $dumpFile -DestinationPath "$dumpFile.zip" -Force
Remove-Item $dumpFile

# Rétention glissante
Get-ChildItem $OutDir -Filter "*.zip" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
  Remove-Item -Force

Write-Output "Sauvegarde terminée : $dumpFile.zip"
