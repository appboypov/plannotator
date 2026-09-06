import { buildService, updateService, updateState } from "../index";
import { forkConfig } from "../config/fork-config";

export async function runForkCommand(command: string) {
  let result: unknown;
  switch (command) {
    case "check": result = await updateService.check(); break;
    case "status": result = updateState.read(); break;
    case "update": case "resume":
      result = await updateService.update(command === "resume");
      if (["failed", "conflict"].includes((result as { status: string }).status)) process.exitCode = 1;
      break;
    case "build": case "install": {
      const binary = await buildService.build(forkConfig.root);
      if (command === "install") buildService.install(binary);
      result = { status: command === "install" ? "installed" : "built", binary };
      break;
    }
    case "help": case "--help":
      result = { commands: ["check", "status", "update", "resume", "build", "install"], output: "JSON", exitCodes: { success: 0, conflictOrFailure: 1, usage: 2 } };
      break;
    default: process.exitCode = 2; result = { error: "Unknown command", command };
  }
  console.log(JSON.stringify(result));
}
