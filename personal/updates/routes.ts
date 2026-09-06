import { updateService, updateState } from "./index";
import { UpdateProcessApi } from "./apis/update-process-api";
import { UpdateRouteService } from "./services/update-route-service";
import { forkConfig } from "./config/fork-config";
const routes = new UpdateRouteService(updateService, updateState, new UpdateProcessApi(forkConfig.root));
export const handleForkUpdateRequest = (req: Request) => routes.handle(req);
