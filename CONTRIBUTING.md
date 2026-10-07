# Contributing

Thanks for helping out. Setup and running are covered in the [README](README.md#getting-started).

## Before opening a pull request

```sh
pnpm typecheck
pnpm build
```

CI runs both on every pull request, and `main` only accepts changes through a pull request with passing checks.

## Guidelines

- Keep pull requests focused on one change, and describe what changed and how you tested it.
- Match the style of the code around your change.
- Don't commit secrets, `.env` files, databases or anything from `~/.axis`.
- Report security issues privately, as described in [SECURITY.md](SECURITY.md), not in issues or pull requests.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
