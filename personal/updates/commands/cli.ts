import { runForkCommand } from "./fork-command";
try { await runForkCommand(process.argv[2] || "help"); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
