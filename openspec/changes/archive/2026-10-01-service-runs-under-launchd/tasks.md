## 1. LaunchAgent

- [x] 1.1 `launch-agent.ts`: plan, plist, binary install, load, unload, launchd state; verified by `service-command.test.ts`
- [x] 1.2 `service-command.ts`: `service install|uninstall|status` with exit codes; verified by `service-command.test.ts`
- [x] 1.3 Call sites: `index.ts`, `unknown-subcommand.ts`; `serve-command.ts` passes the label; health answers `service.label`; verified by `service.test.ts`

## 2. Build and docs

- [x] 2.1 `fork/build-binary.ts` builds `fork/dist/plannotator` with the fork version; verified by `fork/dist/plannotator --version`
- [x] 2.2 `fork/README.md`: install, status, uninstall, logs, carried settings
- [x] 2.3 Smoke on this Mac: install, `launchctl print` shows running, kill the process and it comes back, health 200 with the version `plannotator --version` prints, uninstall and reinstall
