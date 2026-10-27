/** What was thrown, as text — never the word "undefined". */
export function thrownMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "An unknown error was thrown.";
}
