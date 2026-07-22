const APPROVAL_VARIABLE = "OPSWATCH_DB_MIGRATION_APPROVAL";
const REQUIRED_VALUE = "EDD_EXPLICITLY_APPROVED";

const supplied = process.env[APPROVAL_VARIABLE]?.trim();

if (supplied !== REQUIRED_VALUE) {
  console.error([
    "Database migration blocked by OpsWatch Rule 6.",
    "No migration may run unless EDD explicitly instructs it.",
    `To run an approved migration, set ${APPROVAL_VARIABLE}=${REQUIRED_VALUE} for that single controlled command only.`
  ].join("\n"));
  process.exit(1);
}

console.log("Explicit database migration approval confirmed for this controlled command.");
