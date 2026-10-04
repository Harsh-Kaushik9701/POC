/**
 * Who can do what. Mirrors the roles table in the requirements.
 * In production this is also enforced by PostgreSQL row-level security and scoped by site/department.
 */
export type Action =
  | "floor.view" | "floor.assign"
  | "timesheets.view" | "timesheets.approve" | "timesheets.correct"
  | "jobsheets.view" | "costs.view"
  | "exceptions.view" | "reports.view" | "payroll.export"
  | "setup.people" | "setup.jobs" | "setup.system" | "audit.view";

const MATRIX: Record<Action, string[]> = {
  "floor.view": ["owner", "admin", "manager", "supervisor"],
  "floor.assign": ["owner", "admin", "manager", "supervisor"],
  "timesheets.view": ["owner", "admin", "manager", "supervisor", "payroll"],
  "timesheets.approve": ["owner", "admin", "manager"],
  "timesheets.correct": ["owner", "admin", "manager", "supervisor"],
  "jobsheets.view": ["owner", "admin", "manager", "supervisor", "payroll"],
  "costs.view": ["owner", "admin", "manager", "payroll"],
  "exceptions.view": ["owner", "admin", "manager", "supervisor"],
  "reports.view": ["owner", "admin", "manager", "payroll"],
  "payroll.export": ["owner", "admin", "payroll"],
  "setup.people": ["owner", "admin", "manager"],
  "setup.jobs": ["owner", "admin", "manager", "supervisor"],
  "setup.system": ["owner", "admin"],
  "audit.view": ["owner", "admin", "payroll"],
};

export function can(role: string, action: Action) {
  return MATRIX[action].includes(role);
}
export const PERMISSION_MATRIX = MATRIX;
