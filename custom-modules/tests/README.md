# Mari Kit tests

Each `*.test.mjs` here is a plain Node script that exits non-zero on failure. `ENGINE_URL` points at a throwaway
Engine with Mari Kit installed (data can be changed). Run by `scripts/verify.mjs` and the daily upstream check.
Name a test that needs the Engine `*.engine.test.mjs` (the Engine starts only for those); others are pure. The
scoped run picks a test when it changed or names a changed file.
