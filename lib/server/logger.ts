export function logError(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    level: "error",
    scope,
    message,
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
  }));
}

export function logInfo(scope: string, message: string, meta?: Record<string, unknown>) {
  console.info(JSON.stringify({
    level: "info",
    scope,
    message,
    ...meta,
    timestamp: new Date().toISOString(),
  }));
}
