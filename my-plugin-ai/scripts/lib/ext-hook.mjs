// Resolve hook: retries extensionless relative imports with ".js" (see register-app-imports.mjs).
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) {
    if (specifier.startsWith(".") && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context);
    throw error;
  }
}
