import React from "react";
import type { UpdateInfo } from "../models/update-info";
import type { Origin } from "../../../packages/core/agents";
interface Props { appVersion: string; updateInfo?: UpdateInfo | null; origin?: Origin | null; isWSL: boolean; closeMenu: () => void; }
export function MenuVersionSection({ appVersion, updateInfo, closeMenu }: Props) {
  const state = updateInfo?.state;
  return <div className="px-3 py-2 space-y-2">
    <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
      <a href="https://github.com/appboypov/plannotator" target="_blank" rel="noopener noreferrer" onClick={closeMenu}>Plannotator · appboypov</a>
      <span>{updateInfo?.currentVersion || appVersion}</span>
    </div>
    {updateInfo && <>
      <a className="text-[11px] text-muted-foreground" href={updateInfo.releaseUrl} target="_blank" rel="noopener noreferrer">{updateInfo.updateAvailable ? `Release ${updateInfo.latestVersion} available` : "Release notes"}</a>
      <button onClick={updateInfo.update} disabled={state?.status === "updating"} className="w-full px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-primary text-primary-foreground disabled:opacity-50">
        {state?.status === "updating" ? "Updating from your fork…" : "Update from your fork"}
      </button>
      {state?.message && <p className="text-[11px] text-muted-foreground">{state.message}</p>}
      {state?.todo && <a className="text-[11px] underline" href={state.todo} target="_blank" rel="noopener noreferrer">Resolve update conflicts in Brian’s todo</a>}
    </>}
  </div>;
}
