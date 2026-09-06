.PHONY: help check status update resume build install test
help check status update resume build install:
	@bun personal/updates/commands/cli.ts $@
test:
	@bun test personal
	@bunx tsc --noEmit -p personal/tsconfig.json
