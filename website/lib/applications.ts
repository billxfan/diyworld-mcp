import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type ApplicationInput = {
  name: string;
  email: string;
  worldType: string;
  selectedWorldId?: string;
  selectedWorld?: string;
  locale?: string;
};

let sql: NeonQueryFunction<false, false> | undefined;
let schemaReady: Promise<void> | undefined;

function getSql() {
  if (sql) return sql;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

  sql = neon(databaseUrl);
  return sql;
}

async function ensureSchema() {
  schemaReady ??= (async () => {
    await getSql()`
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        world_type TEXT NOT NULL,
        selected_world_id TEXT,
        selected_world TEXT,
        locale TEXT NOT NULL DEFAULT 'zh',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  })();

  await schemaReady;
}

export async function saveApplication(input: ApplicationInput) {
  await ensureSchema();
  const database = getSql();
  const rows = await database`
    INSERT INTO applications (
      name,
      email,
      world_type,
      selected_world_id,
      selected_world,
      locale
    )
    VALUES (
      ${input.name},
      ${input.email},
      ${input.worldType},
      ${input.selectedWorldId ?? null},
      ${input.selectedWorld ?? null},
      ${input.locale ?? "zh"}
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING id, updated_at
  `;

  return {
    id: rows[0] ? Number(rows[0].id) : null,
    created: rows.length === 1,
    updatedAt: rows[0] ? new Date(String(rows[0].updated_at)) : new Date(),
  };
}
