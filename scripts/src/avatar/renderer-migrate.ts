import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

try {
  await pool.query(await readFile(new URL("../../sql/renderer-ownership.sql", import.meta.url), "utf8"));
  console.info("Renderer ownership migration applied.");
} finally { await pool.end(); }
