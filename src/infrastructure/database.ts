import knex, { type Knex } from "knex";

export function createDatabase(connectionString: string): Knex {
  return knex({
    client: "pg",
    connection: connectionString,
    pool: {
      min: 0,
      max: 10,
    },
  });
}
