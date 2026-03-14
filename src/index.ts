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
    await runExtract(NYT_API_KEY, ANTHROPIC_API_KEY);
    break;
  }
  case "check": {
    const { runCheck } = await import("./check.js");
    await runCheck(NYT_API_KEY, ANTHROPIC_API_KEY);
    break;
  }
  case "report": {
    const { runReport } = await import("./report.js");
    runReport();
    break;
  }
  default:
    console.log("Usage: npm run <command>");
    console.log("  extract  — fetch NYT articles and extract speculative claims");
    console.log("  check    — check pending speculations against recent news");
    console.log("  report   — show all speculations and journalist summary");
}
