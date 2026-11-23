export const M145_TEST_PROJECT_REF: string;

export function validateM145Target(input: {
  url?: string;
  projectRef?: string;
  publishableKey?: string;
  allowReal?: string | boolean;
}): {
  ok: boolean;
  status?: "BLOCKED" | "FAIL";
  reason?: string;
  missing?: string[];
  projectRef?: string;
};
