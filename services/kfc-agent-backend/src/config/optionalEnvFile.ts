export function loadOptionalEnvFile(path: string): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}
