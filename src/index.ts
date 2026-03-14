import * as dotenv from "dotenv";
dotenv.config();

const NYT_API_KEY = process.env.NYT_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!NYT_API_KEY) { console.error("Missing NYT_API_KEY in .env"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("Missing ANTHROPIC_API_KEY in .env"); process.exit(1); }

const command = process.argv[2];

switch (command) {
  case "extract": {
    const { runExtract } = await import("./extract.js");
    const backfill = process.argv.includes("--backfill");
    const monthsArg = process.argv.find((a) => a.startsWith("--months="));
    const months = monthsArg ? parseInt(monthsArg.split("=")[1]!, 10) : 1;
    await runExtract(NYT_API_KEY, ANTHROPIC_API_KEY, { backfill, months });
    break;
  }
  case "check": {
    const { runCheck } = await import("./check.js");
    const qa = process.argv.includes("--qa");
    await runCheck(NYT_API_KEY, ANTHROPIC_API_KEY, qa);
    break;
  }
  case "report": {
    const { runReport } = await import("./report.js");
    runReport();
    break;
  }
  case "nightly": {
    const { runNightly } = await import("./nightly.js");
    await runNightly();
    break;
  }
  case "edit": {
    const { runEdit } = await import("./edit.js");
    await runEdit();
    break;
  }
  default:
    console.log("Usage: npm run <command>");
    console.log("  extract              — fetch new NYT articles since last run");
    console.log("  extract:backfill     — fetch one month further back (repeat to go deeper)");
    console.log("  check                — check pending speculations against recent news");
    console.log("  check:qa             — check with interactive review");
    console.log("  report               — show all speculations and journalist summary");
    console.log("  edit                 — edit or correct an existing assessment");
}
