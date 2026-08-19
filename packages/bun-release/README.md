# bun-release

Scripts that release Bun to npm, Dockerhub, Homebrew, etc.

### Running

```sh
bun run upload-npm -- <release> dry-run # build and npm-pack the host package
bun run upload-npm -- <release> publish # explicitly publish the official @oven packages
```

The Termux package path is opt-in and does not publish anything by itself:

```sh
GITHUB_REPOSITORY=PlayWithG/bun \
  BUN_NPM_MODE=termux \
  bun run upload-npm -- termux-v1.3.14 dry-run
GITHUB_REPOSITORY=PlayWithG/bun \
  BUN_NPM_MODE=termux \
  bun run upload-npm -- termux-v1.3.14 publish
```

Use `dry-run` to generate packages and `npm pack` tarballs. `publish` is a separate explicit operation and requires npm authentication; this preparation does not publish, push, or create a release. The Termux release provides the raw GitHub asset `bun` at `PlayWithG/bun` release tag `termux-v1.3.14`. Android ARM64 also requires the Termux libc++ runtime (`libc++`).

The official default remains unscoped `bun` with `@oven/*` platform packages. `BUN_NPM_OWNER` and `BUN_NPM_PLATFORMS` can override the owner and selected platform bins when a different scoped distribution is needed.

### Credits

- [esbuild](https://github.com/evanw/esbuild), for its npm scripts which this was largely based off of.
