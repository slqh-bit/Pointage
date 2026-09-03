/** Bundle français — langue de référence (CHU La Rabta). */
export const fr = {
  common: {
    appName: "Pointage CHU La Rabta",
    save: "Enregistrer",
    cancel: "Annuler",
    confirm: "Confirmer",
    search: "Rechercher",
    loading: "Chargement…",
    noData: "Aucune donnée",
    today: "Aujourd'hui",
    actions: "Actions",
  },
  auth: {
    login: "Connexion",
    logout: "Déconnexion",
    username: "Identifiant",
    password: "Mot de passe",
    loginFailed: "Identifiants invalides",
    accountLocked: "Compte verrouillé, réessayez plus tard",
  },
  nav: {
    dashboard: "Tableau de bord",
    presence: "Présence en direct",
    planning: "Plannings",
    absences: "Absences",
    anomalies: "Anomalies",
    reports: "Rapports",
    devices: "Terminaux",
    employees: "Agents",
    settings: "Paramètres",
  },
  attendance: {
    punchIn: "Pointage entrée",
    punchOut: "Pointage sortie",
    workedMinutes: "Temps travaillé",
    late: "Retard",
    earlyLeave: "Départ anticipé",
    overtime: "Heures supplémentaires",
    theoretical: "Théorique",
  },
  anomalies: {
    MISSING_OUT: "Sortie manquante",
    MISSING_IN: "Entrée manquante",
    NO_PLAN: "Pointage sans planning",
    OFF_SITE: "Pointage hors site affecté",
    IMPOSSIBLE_TRANSITION: "Transition impossible",
    OVERTIME_PENDING: "Heures sup. à valider",
    GEOFENCE_VIOLATION: "Hors zone de géorepérage",
  },
  absences: {
    request: "Demande d'absence",
    approve: "Approuver",
    reject: "Rejeter",
    motif: "Motif",
    balance: "Solde de congés",
    pending: "En attente",
    approved: "Approuvée",
    rejected: "Rejetée",
  },
  devices: {
    status: "État des terminaux",
    online: "En ligne",
    offline: "Hors ligne",
    lastSeen: "Dernier contact",
    tamper: "Sabotage détecté",
    syncUsers: "Synchroniser les utilisateurs",
  },
  reports: {
    monthly: "État mensuel",
    exportXlsx: "Exporter en Excel",
    exportPdf: "Exporter en PDF",
    exportCsv: "Exporter en CSV",
    monthlyClose: "Clôture mensuelle",
  },
} as const;

/** Structure imposée à tous les bundles : mêmes clés que le FR, valeurs libres. */
export type Messages = {
  [Section in keyof typeof fr]: { [Key in keyof (typeof fr)[Section]]: string };
};
