import { useCallback, useEffect, useState } from "react";
import { UpdateBrowserApi } from "../apis/update-browser-api";
import type { UpdateInfo } from "../models/update-info";
export type { UpdateInfo, FeatureHighlight } from "../models/update-info";
const api = new UpdateBrowserApi();
export function useUpdateCheck(): UpdateInfo | null {
  const [info, setInfo] = useState<Omit<UpdateInfo, "dismiss" | "update"> | null>(null);
  const dismiss = useCallback(() => setInfo((value) => value && ({ ...value, dismissed: true })), []);
  const update = useCallback(async () => {
    try {
      await api.start();
      setInfo((value) => value && ({ ...value, state: { status: "updating" } }));
    } catch (error) {
      setInfo((value) => value && ({ ...value, state: { status: "failed", message: String(error) } }));
    }
  }, []);
  useEffect(() => {
    let live = true;
    api.check().then((value) => { if (live) setInfo({ ...value, dismissed: false }); }).catch(() => {});
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (info?.state.status !== "updating") return;
    const timer = setInterval(() => api.status().then((state) => setInfo((value) => value && ({ ...value, state }))).catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [info?.state.status]);
  return info && { ...info, dismiss, update };
}
