# Mari Kit tests

Each `*.test.mjs` here is a plain Node script that exits non-zero on failure. `ENGINE_URL` points at a throwaway
Engine with Mari Kit installed (data can be changed). Run by `scripts/verify.mjs` and the daily upstream check.
Pure checks that need no Engine can ignore `ENGINE_URL`.
