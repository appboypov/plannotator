import { join } from "node:path";
import { CommandApi } from "../core/apis/command-api";
import { forkConfig } from "./config/fork-config";
import { ReleaseApi } from "./apis/release-api";
import { TodoApi } from "./apis/todo-api";
import { UpdateStateApi } from "./apis/update-state-api";
import { BuildService } from "./services/build-service";
import { UpdateService } from "./services/update-service";

const commands = new CommandApi();
export const updateState = new UpdateStateApi(join(forkConfig.root, ".git/personal-update.sqlite"));
export const buildService = new BuildService(commands, forkConfig);
export const updateService = new UpdateService(forkConfig, commands,
  new ReleaseApi(commands, forkConfig.source), new TodoApi(commands, forkConfig.todoTeam), updateState, buildService);
