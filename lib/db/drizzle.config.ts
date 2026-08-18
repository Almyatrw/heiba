const config = {
  schema: "./src/schema",
  out: "./drizzle",
  driver: "pg",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL ?? "postgres://localhost:5432/heiba",
  },
};

export default config;
