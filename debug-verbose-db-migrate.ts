import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";

async function main() {
  console.log("Starting migrations...");
  const db = drizzle({ connection: { source: process.env.DATABASE_URL }, logger: true})
  try {
    await migrate(db, { migrationsFolder: "./src/lib/server/db/migrations", migrationsSchema: './src/lib/server/db/schema.ts' });
    console.log("Migrations applied successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed with error:");
    console.error(error);
    process.exit(1);
  }
}

main();