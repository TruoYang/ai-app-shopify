// Writes prisma/postgres/schema.prisma from prisma/schema.prisma for production (Render).
//
// Local development keeps SQLite (prisma/schema.prisma + prisma/migrations). Production uses
// Postgres with its own schema copy and migrations in prisma/postgres/. After changing the main
// schema, run:
//   npm run db:pg-schema
//   npx prisma migrate diff --from-schema-datamodel <previous pg schema> ... (or see docs/DEPLOY.md)
import fs from "fs";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const source = path.join(root, "prisma", "schema.prisma");
const target = path.join(root, "prisma", "postgres", "schema.prisma");

let schema = fs.readFileSync(source, "utf8");
const before = schema;
schema = schema.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
if (schema === before) throw new Error('prisma/schema.prisma has no provider = "sqlite" to replace');
schema = `// GENERATED from prisma/schema.prisma by scripts/db/make-postgres-schema.mjs. Do not edit.\n${schema}`;

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, schema);
console.log(`Wrote ${path.relative(root, target)}`);
