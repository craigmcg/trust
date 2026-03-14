import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.join(__dirname, "..", "speculations.db");

export type Status = "pending" | "confirmed" | "refuted" | "partial";

export interface Speculation {
  id: number;
  journalist: string;
  article_headline: string;
  article_url: string;
  article_date: string;
  claim: string;
  verbatim: string;
  timeframe: string;
  status: Status;
  evidence: string;
  evidence_url: string;
  checked_at: string;
  created_at: string;
}

export function openDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS speculations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      journalist      TEXT NOT NULL,
      article_headline TEXT NOT NULL,
      article_url     TEXT NOT NULL,
      article_date    TEXT NOT NULL,
      claim           TEXT NOT NULL,
      verbatim        TEXT NOT NULL,
      timeframe       TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'pending',
      evidence        TEXT NOT NULL DEFAULT '',
      evidence_url    TEXT NOT NULL DEFAULT '',
      checked_at      TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique
      ON speculations(article_url, verbatim);
  `);
  return db;
}

export function insertSpeculation(
  db: Database.Database,
  row: Omit<Speculation, "id" | "status" | "evidence" | "evidence_url" | "checked_at" | "created_at">
): void {
  db.prepare(`
    INSERT OR IGNORE INTO speculations
      (journalist, article_headline, article_url, article_date, claim, verbatim, timeframe)
    VALUES
      (@journalist, @article_headline, @article_url, @article_date, @claim, @verbatim, @timeframe)
  `).run(row);
}

export function getPending(db: Database.Database): Speculation[] {
  return db.prepare(`SELECT * FROM speculations WHERE status = 'pending' ORDER BY article_date DESC`).all() as Speculation[];
}

export function updateStatus(
  db: Database.Database,
  id: number,
  status: Status,
  evidence: string,
  evidence_url: string
): void {
  db.prepare(`
    UPDATE speculations
    SET status = ?, evidence = ?, evidence_url = ?, checked_at = datetime('now')
    WHERE id = ?
  `).run(status, evidence, evidence_url, id);
}

export function getAll(db: Database.Database): Speculation[] {
  return db.prepare(`SELECT * FROM speculations ORDER BY article_date DESC`).all() as Speculation[];
}
